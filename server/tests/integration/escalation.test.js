import { createApp, query, resetDatabase, signIn, skipReason } from './helpers.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { closePool } from '../../src/db/pool.js';
import { runEscalationCheck } from '../../src/services/escalationService.js';

// SLA escalation. The check is run with an explicit `now`, so every case is deterministic:
// SLA target 4h and level 2 after another 2h (pinned in env.js).

const HOUR = 3_600_000;

describe('SLA escalation', { skip: skipReason }, () => {
  let app;
  let admin;
  let agent;

  before(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await signIn(app, 'admin@demo.test', 'admin123');
    agent = await signIn(app, 'priya@demo.test', 'agent123');
  });

  after(closePool);

  /** Creates a ticket and returns it with helpers relative to its SLA deadline. */
  async function newTicket(overrides = {}) {
    const ticket = (
      await agent
        .post('/api/tickets', { subject: 'Help', customerName: 'Jo', description: 'Broken', ...overrides })
        .expect(201)
    ).body.data;
    // Postgres keeps microseconds but JSON dates have milliseconds; trim the stored value so
    // `at(0)` is exactly the deadline and boundary cases are exact.
    await query(`UPDATE tickets SET created_at = date_trunc('milliseconds', created_at) WHERE id = $1`, [ticket.id]);
    const deadline = Date.parse(ticket.createdAt) + 4 * HOUR;
    return { ...ticket, at: (offsetMs) => new Date(deadline + offsetMs) };
  }
  const escalationsOf = async (id) =>
    (await query('SELECT stage, rule, acknowledged_at, acknowledged_by FROM ticket_escalations WHERE ticket_id = $1 ORDER BY stage', [id])).rows;
  const eventsOf = async (id, type) =>
    (await query('SELECT actor_id, new_value FROM ticket_events WHERE ticket_id = $1 AND event_type = $2 ORDER BY id', [id, type])).rows;
  const stages = async (id) => (await escalationsOf(id)).map((e) => e.stage);
  const detail = async (id) => (await agent.get(`/api/tickets/${id}`).expect(200)).body.data;
  // Writes a public reply at a chosen time (the API would stamp the real time).
  const replyAt = async (id, when) => {
    await agent.post(`/api/tickets/${id}/messages`, { kind: 'reply', body: 'Hello' }).expect(201);
    await query('UPDATE tickets SET first_response_at = $2 WHERE id = $1', [id, when]);
  };

  describe('rules', () => {
    it('does not escalate before the deadline, including while approaching or critical', async () => {
      const t = await newTicket();
      for (const offset of [-2 * HOUR, -30 * 60_000, -5 * 60_000, -1000]) {
        await runEscalationCheck({ now: t.at(offset) });
      }
      assert.deepEqual(await stages(t.id), []);
    });

    it('escalates to level 1 at the deadline, with a system history event', async () => {
      const t = await newTicket();
      const result = await runEscalationCheck({ now: t.at(0) });
      assert.deepEqual(result.escalated, [{ ticketId: t.id, stage: 1 }]);
      assert.deepEqual(result.failedStages, []);
      const [record] = await escalationsOf(t.id);
      assert.deepEqual([record.stage, record.rule, record.acknowledged_at], [1, 'first_response_sla_breached', null]);
      assert.deepEqual(await eventsOf(t.id, 'escalated'), [{ actor_id: null, new_value: 'Level 1: Escalated' }]);
    });

    it('escalates to level 2 only once the extra period has passed', async () => {
      const t = await newTicket();
      await runEscalationCheck({ now: t.at(2 * HOUR - 1000) });
      assert.deepEqual(await stages(t.id), [1]);
      await runEscalationCheck({ now: t.at(2 * HOUR) });
      assert.deepEqual(await stages(t.id), [1, 2]);
      assert.deepEqual(
        (await eventsOf(t.id, 'escalated')).map((e) => e.new_value),
        ['Level 1: Escalated', 'Level 2: Senior attention'],
      );
    });

    it('never escalates a ticket answered on time', async () => {
      const t = await newTicket();
      await agent.post(`/api/tickets/${t.id}/messages`, { kind: 'reply', body: 'On it' }).expect(201);
      await runEscalationCheck({ now: t.at(10 * HOUR) });
      assert.deepEqual(await stages(t.id), []);
    });

    it('does not treat an internal note as a first response', async () => {
      const t = await newTicket();
      await agent.post(`/api/tickets/${t.id}/messages`, { kind: 'note', body: 'Investigating' }).expect(201);
      await runEscalationCheck({ now: t.at(0) });
      assert.deepEqual(await stages(t.id), [1]);
    });

    it('stops at the stage reached when a late public reply is sent, and keeps the SLA breach', async () => {
      const t = await newTicket();
      await runEscalationCheck({ now: t.at(HOUR) });
      await replyAt(t.id, t.at(HOUR + 60_000));
      await runEscalationCheck({ now: t.at(5 * HOUR) });
      assert.deepEqual(await stages(t.id), [1]);

      const ticket = await detail(t.id);
      assert.equal(ticket.sla.urgency, 'responded_late');
      assert.equal(ticket.slaBreached, true);
      assert.equal(ticket.escalation.active, false);
      assert.equal(ticket.escalation.stage, 1);
    });

    it('does not newly escalate a resolved ticket, and ends an existing escalation on resolve', async () => {
      const resolved = await newTicket({ status: 'Resolved' });
      await runEscalationCheck({ now: resolved.at(5 * HOUR) });
      assert.deepEqual(await stages(resolved.id), []);

      const t = await newTicket();
      await runEscalationCheck({ now: t.at(0) });
      await agent.patch(`/api/tickets/${t.id}`, { status: 'Resolved' }).expect(200);
      await runEscalationCheck({ now: t.at(5 * HOUR) });
      assert.deepEqual(await stages(t.id), [1]);
      assert.equal((await detail(t.id)).escalation.active, false);
    });

    it('reactivates the existing escalation when an unanswered ticket is reopened, without duplicates', async () => {
      const t = await newTicket();
      await runEscalationCheck({ now: t.at(0) });
      await agent.patch(`/api/tickets/${t.id}`, { status: 'Resolved' }).expect(200);
      await agent.patch(`/api/tickets/${t.id}`, { status: 'Open' }).expect(200);
      await query(`UPDATE tickets SET created_at = now() - interval '5 hours' WHERE id = $1`, [t.id]);
      await runEscalationCheck();
      assert.deepEqual(await stages(t.id), [1]);
      assert.equal((await eventsOf(t.id, 'escalated')).length, 1);
      assert.equal((await detail(t.id)).escalation.active, true);
    });
  });

  describe('idempotency', () => {
    it('records each stage once however often the check runs', async () => {
      const t = await newTicket();
      for (let i = 0; i < 3; i++) await runEscalationCheck({ now: t.at(3 * HOUR) });
      const again = await runEscalationCheck({ now: t.at(3 * HOUR) });
      assert.deepEqual(again.escalated, []);
      assert.deepEqual(await stages(t.id), [1, 2]);
      assert.equal((await eventsOf(t.id, 'escalated')).length, 2);
    });

    it('records each stage once when checks overlap', async () => {
      const tickets = await Promise.all([newTicket(), newTicket(), newTicket()]);
      const now = tickets[2].at(3 * HOUR); // all three are well past level 2
      const results = await Promise.all(Array.from({ length: 6 }, () => runEscalationCheck({ now })));
      const escalatedTotal = results.flatMap((r) => r.escalated).length;
      assert.equal(escalatedTotal, 6, 'three tickets times two stages, across all runs');
      for (const t of tickets) {
        assert.deepEqual(await stages(t.id), [1, 2]);
        assert.equal((await eventsOf(t.id, 'escalated')).length, 2);
      }
    });

    it('changes nothing else on the ticket', async () => {
      const t = await newTicket({ assigneeId: agent.user.id, priority: 'Low' });
      const before = (await query('SELECT * FROM tickets WHERE id = $1', [t.id])).rows[0];
      const messages = (await query('SELECT count(*)::int AS n FROM ticket_messages WHERE ticket_id = $1', [t.id])).rows[0].n;
      await runEscalationCheck({ now: t.at(3 * HOUR) });
      assert.deepEqual((await query('SELECT * FROM tickets WHERE id = $1', [t.id])).rows[0], before);
      assert.equal((await query('SELECT count(*)::int AS n FROM ticket_messages WHERE ticket_id = $1', [t.id])).rows[0].n, messages);
    });
  });

  describe('acknowledgement', () => {
    const acknowledge = (user, id) => user.post(`/api/tickets/${id}/escalation/acknowledge`, {});

    it('records who acknowledged and when, once, without changing the ticket', async () => {
      const t = await newTicket();
      // Really past both stages, so the escalation is active now (not only at a simulated time).
      await query(`UPDATE tickets SET created_at = now() - interval '7 hours' WHERE id = $1`, [t.id]);
      await runEscalationCheck();
      const before = (await query('SELECT * FROM tickets WHERE id = $1', [t.id])).rows[0];

      const res = await acknowledge(agent, t.id).expect(200);
      assert.deepEqual(res.body.data.acknowledgedStages, [1, 2]);
      assert.ok(res.body.data.escalations.every((e) => e.acknowledgedByName === 'Priya Agent' && e.acknowledgedAt));
      assert.deepEqual(await eventsOf(t.id, 'escalation_acknowledged'), [{ actor_id: agent.user.id, new_value: 'Level 2: Senior attention' }]);

      const again = await acknowledge(admin, t.id).expect(200);
      assert.deepEqual(again.body.data.acknowledgedStages, []);
      assert.equal((await eventsOf(t.id, 'escalation_acknowledged')).length, 1);
      assert.ok((await escalationsOf(t.id)).every((e) => e.acknowledged_by === agent.user.id));
      assert.deepEqual((await query('SELECT * FROM tickets WHERE id = $1', [t.id])).rows[0], before);

      const summary = (await detail(t.id)).escalation;
      assert.equal(summary.acknowledgedByName, 'Priya Agent');
      assert.equal(summary.active, true, 'acknowledging does not end the escalation');
    });

    it('writes one event when acknowledgements overlap', async () => {
      const t = await newTicket();
      await runEscalationCheck({ now: t.at(0) });
      const results = await Promise.all([acknowledge(agent, t.id), acknowledge(admin, t.id), acknowledge(agent, t.id)]);
      assert.ok(results.every((r) => r.status === 200));
      assert.equal(results.filter((r) => r.body.data.acknowledgedStages.length).length, 1);
      assert.equal((await eventsOf(t.id, 'escalation_acknowledged')).length, 1);
    });

    it('acknowledges a newly reached stage separately', async () => {
      const t = await newTicket();
      await runEscalationCheck({ now: t.at(0) });
      await acknowledge(agent, t.id).expect(200);
      await runEscalationCheck({ now: t.at(2 * HOUR) });
      assert.deepEqual((await acknowledge(admin, t.id).expect(200)).body.data.acknowledgedStages, [2]);
      assert.equal((await eventsOf(t.id, 'escalation_acknowledged')).length, 2);
    });

    it('requires a signed-in user, an existing ticket and a valid id', async () => {
      const t = await newTicket();
      await request(app).post(`/api/tickets/${t.id}/escalation/acknowledge`).expect(401);
      await acknowledge(agent, 999999).expect(404);
      await agent.post('/api/tickets/abc/escalation/acknowledge', {}).expect(400);
    });
  });

  describe('manual run', () => {
    it('is available to admins only and escalates breached tickets', async () => {
      const t = await newTicket();
      await query(`UPDATE tickets SET created_at = now() - interval '5 hours' WHERE id = $1`, [t.id]);

      await request(app).post('/api/admin/escalations/run').expect(401);
      assert.equal((await agent.post('/api/admin/escalations/run', {}).expect(403)).body.error.code, 'FORBIDDEN');
      assert.deepEqual(await stages(t.id), []);

      const res = await admin.post('/api/admin/escalations/run', { now: '2099-01-01T00:00:00Z' }).expect(200);
      assert.deepEqual(res.body.data.escalated, [{ ticketId: t.id, stage: 1 }], 'body input is ignored: real time is used');
      assert.deepEqual((await admin.post('/api/admin/escalations/run', {}).expect(200)).body.data.escalated, []);
    });
  });

  describe('list, detail and dashboard', () => {
    it('filters escalated tickets before pagination and keeps the dashboard counts consistent', async () => {
      const level2 = await newTicket({ subject: 'Level 2' });
      const level1 = await newTicket({ subject: 'Level 1' });
      const lateReply = await newTicket({ subject: 'Late reply' });
      await newTicket({ subject: 'Fresh' });
      await query(`UPDATE tickets SET created_at = now() - interval '7 hours' WHERE id = ANY($1)`, [[level2.id, lateReply.id]]);
      await query(`UPDATE tickets SET created_at = now() - interval '5 hours' WHERE id = $1`, [level1.id]);
      await runEscalationCheck();
      await agent.post(`/api/tickets/${lateReply.id}/messages`, { kind: 'reply', body: 'Sorry' }).expect(201);

      const subjects = async (q) => (await agent.get(`/api/tickets?sort=created&${q}`).expect(200)).body;
      const active = await subjects('escalation=active');
      assert.deepEqual(active.data.map((t) => t.subject).sort(), ['Level 1', 'Level 2']);
      assert.deepEqual((await subjects('escalation=level2')).data.map((t) => t.subject), ['Level 2']);
      assert.equal((await subjects('escalation=active&pageSize=1')).pagination.total, 2);
      assert.deepEqual((await subjects('escalation=active&search=Level 2')).data.map((t) => t.subject), ['Level 2']);
      await agent.get('/api/tickets?escalation=everything').expect(400);

      const { counts } = (await agent.get('/api/dashboard')).body.data;
      assert.equal(counts.escalated, 2);
      assert.equal(counts.escalatedLevel2, 1);
      assert.equal(counts.slaBreached, 3, 'the late reply is still an SLA breach, but no longer escalated');

      const rows = (await agent.get('/api/tickets?sort=created')).body.data;
      const bySubject = Object.fromEntries(rows.map((t) => [t.subject, t.escalation]));
      assert.equal(bySubject.Fresh, null);
      assert.deepEqual([bySubject['Level 2'].stage, bySubject['Level 2'].active], [2, true]);
      assert.deepEqual([bySubject['Late reply'].stage, bySubject['Late reply'].active], [2, false]);

      const ticket = await detail(level2.id);
      assert.deepEqual(ticket.escalations.map((e) => [e.stage, e.label]), [[1, 'Escalated'], [2, 'Senior attention']]);
      assert.deepEqual(ticket.escalationPolicy, { level2Hours: 2 });
    });
  });
});
