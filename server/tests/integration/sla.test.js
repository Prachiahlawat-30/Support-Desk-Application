import { createApp, query, resetDatabase, signIn, skipReason } from './helpers.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { urgencyForRemaining } from '../../../client/src/lib/sla.js';
import { closePool } from '../../src/db/pool.js';
import { slaBreachedSql, slaColumnsSql } from '../../src/domain/rules.js';

const SLA_HOURS = 4; // pinned in env.js
const CREATED = '2026-03-01T08:00:00.000Z';
const DEADLINE = '2026-03-01T12:00:00.000Z';
const at = (offsetSeconds, base = DEADLINE) => new Date(Date.parse(base) + offsetSeconds * 1000).toISOString();

/** Evaluates the SLA SQL for one synthetic ticket at a fixed "now". */
async function evaluate({ now, firstResponseAt = null, status = 'Open' }) {
  const { rows } = await query(
    `SELECT ${slaColumnsSql(SLA_HOURS, 't', '$1::timestamptz')}
     FROM (SELECT $2::timestamptz AS created_at, $3::timestamptz AS first_response_at, $4::text AS status) t`,
    [now, CREATED, firstResponseAt, status],
  );
  return rows[0];
}

describe('First-response SLA', { skip: skipReason }, () => {
  let app;
  let agent;

  before(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    agent = await signIn(app, 'priya@demo.test', 'agent123');
  });

  after(closePool);

  describe('rule boundaries (SQL evaluated at a fixed time)', () => {
    const countdown = [
      ['more than 60 minutes left', -3601, 'on_track'],
      ['exactly 60 minutes left', -3600, 'approaching'],
      ['between 15 and 60 minutes left', -1800, 'approaching'],
      ['just over 15 minutes left', -901, 'approaching'],
      ['exactly 15 minutes left', -900, 'critical'],
      ['one second left', -1, 'critical'],
      ['exactly at the deadline', 0, 'breached'],
      ['past the deadline', 7800, 'breached'],
    ];
    for (const [name, offset, urgency] of countdown) {
      it(`no reply, ${name}: ${urgency}`, async () => {
        const row = await evaluate({ now: at(offset) });
        assert.equal(row.sla_urgency, urgency);
        assert.equal(row.sla_remaining_seconds, 0 - offset); // not -offset: -0 !== 0
        assert.equal(row.sla_breached, urgency === 'breached');
        assert.equal(new Date(row.sla_deadline).toISOString(), DEADLINE);
        // The client's live countdown classifies the same remaining time identically.
        assert.equal(urgencyForRemaining(row.sla_remaining_seconds), urgency);
      });
    }

    it('rounds partial seconds up, keeping the urgency consistent', async () => {
      const justOver = await evaluate({ now: new Date(Date.parse(DEADLINE) - 900_400).toISOString() });
      assert.equal(justOver.sla_urgency, 'approaching');
      assert.equal(urgencyForRemaining(justOver.sla_remaining_seconds), 'approaching');
      const justUnder = await evaluate({ now: new Date(Date.parse(DEADLINE) - 400).toISOString() });
      assert.equal(justUnder.sla_urgency, 'critical');
      assert.equal(urgencyForRemaining(justUnder.sla_remaining_seconds), 'critical');
    });

    it('counts a reply exactly at the deadline as on time and one second later as late', async () => {
      const onTime = await evaluate({ now: at(3600), firstResponseAt: DEADLINE });
      assert.equal(onTime.sla_urgency, 'responded_on_time');
      assert.equal(onTime.sla_breached, false);
      assert.equal(onTime.sla_remaining_seconds, null);

      const late = await evaluate({ now: at(3600), firstResponseAt: at(1) });
      assert.equal(late.sla_urgency, 'responded_late');
      assert.equal(late.sla_breached, true);
    });

    it('keeps the response result after resolution and stops the countdown for unanswered resolved tickets', async () => {
      assert.equal((await evaluate({ now: at(9999), firstResponseAt: at(60), status: 'Resolved' })).sla_urgency, 'responded_late');
      assert.equal((await evaluate({ now: at(9999), firstResponseAt: at(-60), status: 'Resolved' })).sla_urgency, 'responded_on_time');
      const resolved = await evaluate({ now: at(9999), status: 'Resolved' });
      assert.equal(resolved.sla_urgency, 'not_applicable');
      assert.equal(resolved.sla_remaining_seconds, null);
      assert.equal(resolved.sla_breached, false);
    });

    it('defines breach the same way as the urgency', async () => {
      const { rows } = await query(
        `SELECT ${slaBreachedSql(SLA_HOURS, 't', '$1::timestamptz')} AS breached
         FROM (SELECT $2::timestamptz AS created_at, NULL::timestamptz AS first_response_at, 'Open'::text AS status) t`,
        [DEADLINE, CREATED],
      );
      assert.equal(rows[0].breached, true);
    });
  });

  describe('API', () => {
    const create = async (overrides = {}) =>
      (
        await agent
          .post('/api/tickets', { subject: 'Help', customerName: 'Jo', description: 'Something broke', ...overrides })
          .expect(201)
      ).body.data;
    const backdate = (id, minutes) =>
      query(`UPDATE tickets SET created_at = now() - make_interval(mins => $2) WHERE id = $1`, [id, minutes]);
    const slaOf = async (id) => (await agent.get(`/api/tickets/${id}`).expect(200)).body.data.sla;

    it('returns the SLA on every ticket in the list and on the detail page', async () => {
      const fresh = await create({ subject: 'Fresh' });
      const soon = await create({ subject: 'Soon' });
      await backdate(soon.id, 4 * 60 - 30); // 30 minutes left
      const late = await create({ subject: 'Late' });
      await backdate(late.id, 6 * 60);

      const list = (await agent.get('/api/tickets?sort=created').expect(200)).body.data;
      const bySubject = Object.fromEntries(list.map((t) => [t.subject, t.sla]));
      assert.equal(bySubject.Fresh.urgency, 'on_track');
      assert.ok(bySubject.Fresh.remainingSeconds > 3 * 3600 && bySubject.Fresh.remainingSeconds <= 4 * 3600);
      assert.equal(bySubject.Soon.urgency, 'approaching');
      assert.equal(bySubject.Soon.state, 'approaching');
      assert.equal(bySubject.Late.urgency, 'breached');
      assert.ok(bySubject.Late.remainingSeconds <= -2 * 3600);
      assert.equal(bySubject.Fresh.targetHours, SLA_HOURS);

      const detail = await slaOf(fresh.id);
      assert.equal(detail.urgency, 'on_track');
      assert.equal(Date.parse(detail.deadline) - Date.parse(fresh.createdAt), SLA_HOURS * 3600_000);
    });

    it('reports critical urgency as the approaching state', async () => {
      const t = await create();
      await backdate(t.id, 4 * 60 - 10);
      const sla = await slaOf(t.id);
      assert.deepEqual([sla.state, sla.urgency], ['approaching', 'critical']);
    });

    it('ignores internal notes and stops the countdown at the first public reply', async () => {
      const t = await create();
      await agent.post(`/api/tickets/${t.id}/messages`, { kind: 'note', body: 'Looking into it' }).expect(201);
      let sla = await slaOf(t.id);
      assert.equal(sla.urgency, 'on_track');
      assert.equal((await agent.get(`/api/tickets/${t.id}`)).body.data.firstResponseAt, null);

      await agent.post(`/api/tickets/${t.id}/messages`, { kind: 'reply', body: 'We are on it' }).expect(201);
      sla = await slaOf(t.id);
      assert.equal(sla.urgency, 'responded_on_time');
      assert.equal(sla.remainingSeconds, null);
    });

    it('marks a reply after the deadline as late, consistently with the breach flag and filter', async () => {
      const t = await create();
      await backdate(t.id, 5 * 60);
      await agent.post(`/api/tickets/${t.id}/messages`, { kind: 'reply', body: 'Sorry for the wait' }).expect(201);
      const ticket = (await agent.get(`/api/tickets/${t.id}`)).body.data;
      assert.equal(ticket.sla.urgency, 'responded_late');
      assert.equal(ticket.slaBreached, true);
      assert.deepEqual(
        (await agent.get('/api/tickets?slaBreached=true')).body.data.map((x) => x.id),
        [t.id],
      );
    });

    it('stops the countdown when resolved without a reply and resumes it when reopened', async () => {
      const t = await create();
      await backdate(t.id, 5 * 60);
      await agent.patch(`/api/tickets/${t.id}`, { status: 'Resolved' }).expect(200);
      let ticket = (await agent.get(`/api/tickets/${t.id}`)).body.data;
      assert.equal(ticket.sla.urgency, 'not_applicable');
      assert.equal(ticket.slaBreached, false);

      await agent.patch(`/api/tickets/${t.id}`, { status: 'Open' }).expect(200);
      ticket = (await agent.get(`/api/tickets/${t.id}`)).body.data;
      assert.equal(ticket.resolvedAt, null);
      assert.equal(ticket.sla.urgency, 'breached');
    });

    it('keeps the dashboard SLA count equal to the breached countdowns in the list', async () => {
      const a = await create({ subject: 'A' });
      await backdate(a.id, 5 * 60);
      const b = await create({ subject: 'B' });
      await backdate(b.id, 5 * 60);
      await agent.post(`/api/tickets/${b.id}/messages`, { kind: 'reply', body: 'Late reply' }).expect(201);
      await create({ subject: 'C' });

      const { counts } = (await agent.get('/api/dashboard')).body.data;
      const list = (await agent.get('/api/tickets')).body.data;
      const breachedInList = list.filter((t) => ['breached', 'responded_late'].includes(t.sla.urgency) && t.status !== 'Resolved');
      assert.equal(counts.slaBreached, 2);
      assert.equal(breachedInList.length, counts.slaBreached);
    });

    it('includes the SLA on the dashboard overdue list', async () => {
      const t = await create();
      await query(`UPDATE tickets SET created_at = now() - interval '25 hours' WHERE id = $1`, [t.id]);
      const [overdue] = (await agent.get('/api/dashboard')).body.data.overdueTickets;
      assert.equal(overdue.sla.urgency, 'breached');
    });
  });
});
