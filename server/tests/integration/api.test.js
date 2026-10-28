import { createApp, query, resetDatabase, signIn, skipReason } from './helpers.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { ATTENTION_CARDS, STATUS_CARDS, UNRESOLVED } from '../../../client/src/lib/dashboardCards.js';
import { closePool } from '../../src/db/pool.js';
import { runEscalationCheck } from '../../src/services/escalationService.js';

const newTicket = (overrides = {}) => ({
  subject: 'Cannot log in',
  customerName: 'Jane Doe',
  customerEmail: 'jane@example.com',
  description: 'Login button does nothing',
  priority: 'Medium',
  ...overrides,
});

const subjects = (res) => res.body.data.map((t) => t.subject);

describe('Support desk API', { skip: skipReason }, () => {
  let app;
  let admin;
  let agent;
  let users;

  before(() => {
    app = createApp();
  });

  beforeEach(async () => {
    users = await resetDatabase();
    admin = await signIn(app, 'admin@demo.test', 'admin123');
    agent = await signIn(app, 'priya@demo.test', 'agent123');
  });

  after(closePool);

  describe('authentication', () => {
    it('rejects requests without a token', async () => {
      const res = await request(app).get('/api/tickets').expect(401);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    it('rejects a wrong password and an invalid token', async () => {
      await request(app).post('/api/auth/login').send({ email: 'admin@demo.test', password: 'nope' }).expect(401);
      await request(app).get('/api/tickets').set('Authorization', 'Bearer garbage').expect(401);
    });

    it('returns the current user', async () => {
      const res = await agent.get('/api/auth/me').expect(200);
      assert.equal(res.body.data.email, 'priya@demo.test');
      assert.equal(res.body.data.role, 'agent');
    });
  });

  describe('creating and viewing tickets', () => {
    it('validates required fields on the server', async () => {
      const res = await agent.post('/api/tickets', { subject: ' ', priority: 'Critical' }).expect(400);
      assert.equal(res.body.error.code, 'VALIDATION_ERROR');
      assert.deepEqual(Object.keys(res.body.error.details).sort(), ['customer', 'description', 'priority', 'subject']);
    });

    it('rejects malformed JSON', async () => {
      const res = await request(app)
        .post('/api/tickets')
        .set(agent.auth)
        .set('Content-Type', 'application/json')
        .send('{"subject":')
        .expect(400);
      assert.match(res.body.error.message, /not valid JSON/);
    });

    it('creates a ticket with defaults and a "created" history entry', async () => {
      const created = await agent.post('/api/tickets', newTicket({ assigneeId: users['sam@demo.test'].id })).expect(201);
      const ticket = created.body.data;
      assert.equal(ticket.status, 'Open');
      assert.equal(ticket.assigneeName, 'Sam Agent');
      assert.equal(ticket.isOverdue, false);

      const detail = (await agent.get(`/api/tickets/${ticket.id}`).expect(200)).body.data;
      assert.deepEqual(
        detail.events.map((e) => e.eventType),
        ['created', 'assignee_changed'],
      );
      assert.equal(detail.events[0].actorName, 'Priya Agent');
    });

    it('rejects an assignee that does not exist', async () => {
      const res = await agent.post('/api/tickets', newTicket({ assigneeId: 9999 })).expect(400);
      assert.ok(res.body.error.details.assigneeId);
    });

    it('returns 404 for a missing ticket and 400 for a malformed id', async () => {
      await agent.get('/api/tickets/9999').expect(404);
      await agent.get('/api/tickets/abc').expect(400);
      await agent.patch('/api/tickets/9999', { status: 'Resolved' }).expect(404);
      await agent.post('/api/tickets/9999/messages', { kind: 'reply', body: 'hi' }).expect(404);
    });
  });

  describe('updating tickets', () => {
    it('writes one history entry per changed status, priority and assignee', async () => {
      const { id } = (await agent.post('/api/tickets', newTicket())).body.data;
      const res = await agent
        .patch(`/api/tickets/${id}`, { status: 'In Progress', priority: 'Urgent', assigneeId: agent.user.id })
        .expect(200);
      assert.equal(res.body.data.status, 'In Progress');
      assert.equal(res.body.data.assigneeName, 'Priya Agent');

      const { events } = (await agent.get(`/api/tickets/${id}`)).body.data;
      const changes = events.slice(1).map(({ eventType, oldValue, newValue }) => [eventType, oldValue, newValue]);
      assert.deepEqual(changes, [
        ['status_changed', 'Open', 'In Progress'],
        ['priority_changed', 'Medium', 'Urgent'],
        ['assignee_changed', null, 'Priya Agent'],
      ]);
    });

    it('does not touch history or updatedAt for a no-op update', async () => {
      const ticket = (await agent.post('/api/tickets', newTicket())).body.data;
      const res = await agent.patch(`/api/tickets/${ticket.id}`, { status: 'Open', priority: 'Medium' }).expect(200);
      assert.equal(res.body.data.updatedAt, ticket.updatedAt);
      const { events } = (await agent.get(`/api/tickets/${ticket.id}`)).body.data;
      assert.equal(events.length, 1);
    });

    it('keeps at least one customer identifier', async () => {
      const { id } = (await agent.post('/api/tickets', newTicket({ customerEmail: null }))).body.data;
      const res = await agent.patch(`/api/tickets/${id}`, { customerName: '' }).expect(400);
      assert.ok(res.body.error.details.customer);
      await agent.patch(`/api/tickets/${id}`, { customerName: '', customerEmail: 'x@example.com' }).expect(200);
    });

    it('sets resolvedAt when resolved and clears it when reopened', async () => {
      const { id } = (await agent.post('/api/tickets', newTicket())).body.data;
      const resolved = (await agent.patch(`/api/tickets/${id}`, { status: 'Resolved' })).body.data;
      assert.ok(resolved.resolvedAt);
      const reopened = (await agent.patch(`/api/tickets/${id}`, { status: 'Open' })).body.data;
      assert.equal(reopened.resolvedAt, null);
    });
  });

  describe('replies and internal notes', () => {
    it('stores entries chronologically with author, and only replies count as a first response', async () => {
      const { id } = (await agent.post('/api/tickets', newTicket())).body.data;

      const note = await agent.post(`/api/tickets/${id}/messages`, { kind: 'note', body: 'Checking logs' }).expect(201);
      assert.equal(note.body.data.authorName, 'Priya Agent');
      let detail = (await agent.get(`/api/tickets/${id}`)).body.data;
      assert.equal(detail.firstResponseAt, null);

      await admin.post(`/api/tickets/${id}/messages`, { kind: 'reply', body: 'We are on it' }).expect(201);
      detail = (await agent.get(`/api/tickets/${id}`)).body.data;

      assert.deepEqual(
        detail.messages.map((m) => [m.kind, m.body, m.authorName]),
        [
          ['note', 'Checking logs', 'Priya Agent'],
          ['reply', 'We are on it', 'Alex Admin'],
        ],
      );
      assert.ok(detail.firstResponseAt);
      assert.deepEqual(
        detail.events.map((e) => e.eventType),
        ['created', 'note_added', 'reply_added'],
      );
    });

    it('validates message input', async () => {
      const { id } = (await agent.post('/api/tickets', newTicket())).body.data;
      const res = await agent.post(`/api/tickets/${id}/messages`, { kind: 'sms', body: '' }).expect(400);
      assert.ok(res.body.error.details.kind);
      assert.ok(res.body.error.details.body);
    });
  });

  describe('listing, search, filters and sorting', () => {
    beforeEach(async () => {
      await agent.post('/api/tickets', newTicket({ subject: 'Invoice wrong', customerEmail: 'billing@acme.example', priority: 'Low' }));
      await agent.post('/api/tickets', newTicket({ subject: 'App crash', priority: 'Urgent', assigneeId: agent.user.id }));
      await agent.post('/api/tickets', newTicket({ subject: 'Slow page', priority: 'High', status: 'In Progress' }));
      await agent.post('/api/tickets', newTicket({ subject: '100% CPU', priority: 'Medium' }));
    });

    it('searches subject and customer email, treating % literally', async () => {
      assert.deepEqual(subjects(await agent.get('/api/tickets?search=ACME')), ['Invoice wrong']);
      assert.deepEqual(subjects(await agent.get('/api/tickets?search=crash')), ['App crash']);
      assert.deepEqual(subjects(await agent.get('/api/tickets?search=%25')), ['100% CPU']);
    });

    it('combines status, priority and assignee filters', async () => {
      assert.deepEqual(subjects(await agent.get('/api/tickets?status=Open&priority=Urgent,Low&assignee=me')), ['App crash']);
      assert.deepEqual(
        subjects(await agent.get('/api/tickets?status=Open&assignee=unassigned&sort=priority')),
        ['100% CPU', 'Invoice wrong'],
      );
    });

    it('sorts by priority and by last update', async () => {
      assert.deepEqual(subjects(await agent.get('/api/tickets?sort=priority')), ['App crash', 'Slow page', '100% CPU', 'Invoice wrong']);
      const [first] = (await agent.get('/api/tickets')).body.data;
      assert.equal(first.subject, '100% CPU');
    });

    it('paginates', async () => {
      const res = await agent.get('/api/tickets?pageSize=3&page=2').expect(200);
      assert.equal(res.body.data.length, 1);
      assert.deepEqual(res.body.pagination, { page: 2, pageSize: 3, total: 4, totalPages: 2 });
    });

    it('rejects invalid filters', async () => {
      const res = await agent.get('/api/tickets?status=Closed').expect(400);
      assert.ok(res.body.error.details.status);
    });
  });

  describe('overdue rule and dashboard', () => {
    it('counts saved tickets and applies the overdue and resolution rules', async () => {
      const old = (await agent.post('/api/tickets', newTicket({ subject: 'Old', priority: 'Urgent' }))).body.data;
      await agent.post('/api/tickets', newTicket({ subject: 'Fresh', status: 'In Progress' }));
      await query(`UPDATE tickets SET created_at = now() - interval '25 hours' WHERE id = $1`, [old.id]);

      let dash = (await agent.get('/api/dashboard').expect(200)).body.data;
      assert.deepEqual(
        { ...dash.counts },
        { total: 2, open: 1, inProgress: 1, waitingOnCustomer: 0, resolved: 0, urgent: 1, overdue: 1, slaBreached: 1, slaDue: 0, unassigned: 2, escalated: 0, escalatedLevel2: 0 },
      );
      assert.deepEqual(dash.overdueTickets.map((t) => t.subject), ['Old']);
      assert.deepEqual(subjects(await agent.get('/api/tickets?overdue=true')), ['Old']);
      assert.equal((await agent.get(`/api/tickets/${old.id}`)).body.data.isOverdue, true);

      // Resolving removes it from open, urgent and overdue counts.
      await agent.patch(`/api/tickets/${old.id}`, { status: 'Resolved' }).expect(200);
      dash = (await agent.get('/api/dashboard')).body.data;
      assert.equal(dash.counts.open, 0);
      assert.equal(dash.counts.resolved, 1);
      assert.equal(dash.counts.urgent, 0);
      assert.equal(dash.counts.overdue, 0);
      assert.equal(dash.overdueTickets.length, 0);
      assert.equal((await agent.get(`/api/tickets/${old.id}`)).body.data.isOverdue, false);
    });
  });

  describe('dashboard consistency', () => {
    const dashboard = async (user) => (await user.get('/api/dashboard').expect(200)).body.data;
    const listFor = (to, user) => user.get(`/api/tickets${new URL(to, 'http://localhost').search}`).expect(200);

    it('requires a signed-in user', async () => {
      await request(app).get('/api/dashboard').expect(401);
    });

    it('tracks unassigned tickets as they are assigned, unassigned and resolved', async () => {
      const a = (await agent.post('/api/tickets', newTicket({ subject: 'A' }))).body.data;
      const b = (await agent.post('/api/tickets', newTicket({ subject: 'B' }))).body.data;
      const c = (await agent.post('/api/tickets', newTicket({ subject: 'C', assigneeId: agent.user.id }))).body.data;
      assert.equal((await dashboard(agent)).counts.unassigned, 2);

      await agent.patch(`/api/tickets/${a.id}`, { assigneeId: admin.user.id }).expect(200);
      assert.equal((await dashboard(agent)).counts.unassigned, 1);

      await agent.patch(`/api/tickets/${c.id}`, { assigneeId: null }).expect(200);
      assert.equal((await dashboard(agent)).counts.unassigned, 2);

      // Resolved tickets need no owner, so they drop out of the count.
      await agent.patch(`/api/tickets/${b.id}`, { status: 'Resolved' }).expect(200);
      assert.equal((await dashboard(admin)).counts.unassigned, 1);

      const unassignedCard = ATTENTION_CARDS.find((card) => card.key === 'unassigned');
      assert.deepEqual(subjects(await listFor(unassignedCard.to, agent)), ['C']);
      assert.deepEqual(subjects(await agent.get(`/api/tickets?assignee=unassigned&status=${UNRESOLVED}`)), ['C']);
    });

    it('gives every card the same count as the ticket list it links to', async () => {
      const create = async (overrides) => (await agent.post('/api/tickets', newTicket(overrides)).expect(201)).body.data;
      const backdate = (id, hours) =>
        query(`UPDATE tickets SET created_at = now() - make_interval(hours => $2) WHERE id = $1`, [id, hours]);

      // Overdue, SLA breached (never answered), urgent and unassigned.
      const neglected = await create({ subject: 'Neglected', priority: 'Urgent' });
      await backdate(neglected.id, 25);
      // Overdue and SLA breached (answered late), assigned.
      const late = await create({ subject: 'Late reply', priority: 'High', status: 'In Progress', assigneeId: agent.user.id });
      await agent.post(`/api/tickets/${late.id}/messages`, { kind: 'reply', body: 'Sorry for the wait' }).expect(201);
      await backdate(late.id, 25);
      // Answered in time: not breached, not overdue.
      const onTime = await create({ subject: 'On time', assigneeId: admin.user.id });
      await agent.post(`/api/tickets/${onTime.id}/messages`, { kind: 'reply', body: 'On it' }).expect(201);
      await backdate(onTime.id, 2);
      // Fresh and unassigned; only an internal note, which is not a response.
      const fresh = await create({ subject: 'Fresh', status: 'Waiting on Customer' });
      await agent.post(`/api/tickets/${fresh.id}/messages`, { kind: 'note', body: 'Checking logs' }).expect(201);
      // Resolved after a late reply: breached, urgent and unassigned, but excluded from every attention count.
      const resolved = await create({ subject: 'Resolved', priority: 'Urgent' });
      await agent.post(`/api/tickets/${resolved.id}/messages`, { kind: 'reply', body: 'Fixed' }).expect(201);
      await agent.patch(`/api/tickets/${resolved.id}`, { status: 'Resolved' }).expect(200);
      await backdate(resolved.id, 25);

      // Neglected is escalated to both levels; the late reply is SLA-breached but not escalated.
      await runEscalationCheck();
      const { counts } = await dashboard(agent);
      assert.deepEqual(
        { ...counts },
        { total: 5, open: 2, inProgress: 1, waitingOnCustomer: 1, resolved: 1, urgent: 1, overdue: 2, slaBreached: 2, slaDue: 0, unassigned: 2, escalated: 1, escalatedLevel2: 1 },
      );

      const cards = [...STATUS_CARDS, ...ATTENTION_CARDS];
      assert.deepEqual(cards.map((card) => card.key).sort(), Object.keys(counts).sort(), 'every count has a card');
      for (const card of cards) {
        const list = await listFor(card.to, agent);
        assert.equal(list.body.pagination.total, counts[card.key], `${card.key} card: ${card.to}`);
      }

      const slaCard = ATTENTION_CARDS.find((card) => card.key === 'slaBreached');
      const breached = (await listFor(slaCard.to, agent)).body.data;
      assert.deepEqual(breached.map((t) => t.subject).sort(), ['Late reply', 'Neglected']);
      assert.ok(breached.every((t) => t.slaBreached));
    });
  });

  describe('deletion policy', () => {
    it('lets only admins delete, and removes replies and history with the ticket', async () => {
      const { id } = (await agent.post('/api/tickets', newTicket())).body.data;
      await agent.post(`/api/tickets/${id}/messages`, { kind: 'reply', body: 'Hello' });

      const forbidden = await agent.delete(`/api/tickets/${id}`).expect(403);
      assert.equal(forbidden.body.error.code, 'FORBIDDEN');

      await admin.delete(`/api/tickets/${id}`).expect(204);
      await admin.get(`/api/tickets/${id}`).expect(404);
      await admin.delete(`/api/tickets/${id}`).expect(404);

      const orphans = await query(
        `SELECT (SELECT count(*) FROM ticket_messages WHERE ticket_id = $1)::int AS messages,
                (SELECT count(*) FROM ticket_events WHERE ticket_id = $1)::int AS events`,
        [id],
      );
      assert.deepEqual(orphans.rows[0], { messages: 0, events: 0 });
    });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await agent.get('/api/nope').expect(404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});
