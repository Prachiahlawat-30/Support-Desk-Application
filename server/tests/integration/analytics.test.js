import { createApp, query, resetDatabase, signIn, skipReason } from './helpers.js';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { closePool } from '../../src/db/pool.js';

// Support analytics against a fixed dataset with exact timestamps (UTC, March 2026). The SLA
// target is 4h (env.js). Range "A" is 2026-03-10 .. 2026-03-12 inclusive.

const HOUR = 3600;
const RANGE_A = 'from=2026-03-10&to=2026-03-12&tz=UTC';

describe('Support analytics', { skip: skipReason }, () => {
  let app;
  let admin;
  let agent;
  let ids; // user ids by first name

  before(() => {
    app = createApp();
  });

  beforeEach(async () => {
    await resetDatabase();
    admin = await signIn(app, 'admin@demo.test', 'admin123');
    agent = await signIn(app, 'priya@demo.test', 'agent123');
    const { rows } = await query(`SELECT id, split_part(name, ' ', 1) AS first FROM users`);
    ids = Object.fromEntries(rows.map((r) => [r.first.toLowerCase(), r.id]));
  });

  after(closePool);

  async function ticket({ subject, created, status = 'Open', priority = 'Medium', assignee = null, resolvedAt = null }) {
    const { rows } = await query(
      `INSERT INTO tickets (subject, customer_name, customer_email, description, status, priority, assignee_id,
                            created_by, created_at, updated_at, resolved_at)
       VALUES ($1, 'Customer', 'customer@example.com', 'Details', $2, $3, $4, $5, $6, $6, $7) RETURNING id`,
      [subject, status, priority, assignee, ids.alex, created, resolvedAt],
    );
    return rows[0].id;
  }
  async function message(ticketId, kind, author, at) {
    await query('INSERT INTO ticket_messages (ticket_id, kind, body, author_id, created_at) VALUES ($1, $2, $3, $4, $5)', [
      ticketId,
      kind,
      `${kind} text`,
      author,
      at,
    ]);
    // Same rule as the message endpoint: only the first public reply sets first_response_at.
    if (kind === 'reply') {
      await query('UPDATE tickets SET first_response_at = coalesce(first_response_at, $2) WHERE id = $1', [ticketId, at]);
    }
  }

  /** The fixed dataset described at the top of each expectation. */
  async function seedRangeA() {
    const t = {};
    t.before = await ticket({ subject: 'T1 just before range', created: '2026-03-09T23:59:59Z' });
    t.start = await ticket({
      subject: 'T2 at range start',
      created: '2026-03-10T00:00:00Z',
      status: 'Resolved',
      assignee: ids.priya,
      resolvedAt: '2026-03-11T00:00:00Z',
    });
    await message(t.start, 'reply', ids.priya, '2026-03-10T01:00:00Z'); // on time (1h)
    t.end = await ticket({ subject: 'T3 at range end', created: '2026-03-12T23:59:59.999Z', priority: 'Urgent' });
    await message(t.end, 'note', ids.sam, '2026-03-13T00:10:00Z'); // a note is not a response
    t.late = await ticket({
      subject: 'T4 late reply',
      created: '2026-03-11T10:00:00Z',
      status: 'In Progress',
      priority: 'High',
      assignee: ids.sam,
    });
    await message(t.late, 'reply', ids.sam, '2026-03-11T15:00:00Z'); // late (5h)
    t.noReply = await ticket({
      subject: 'T5 resolved without reply',
      created: '2026-03-11T12:00:00Z',
      status: 'Resolved',
      priority: 'Low',
      resolvedAt: '2026-03-11T14:00:00Z',
    });
    t.after = await ticket({ subject: 'T6 just after range', created: '2026-03-13T00:00:00Z' });
    t.reopened = await ticket({ subject: 'T7 reopened', created: '2026-03-10T08:00:00Z', assignee: ids.priya });
    await message(t.reopened, 'reply', ids.alex, '2026-03-10T08:30:00Z'); // on time (30m)
    t.oldResolved = await ticket({
      subject: 'T8 created earlier, resolved in range',
      created: '2026-03-01T00:00:00Z',
      status: 'Resolved',
      assignee: ids.sam,
      resolvedAt: '2026-03-12T12:00:00Z',
    });
    await message(t.oldResolved, 'reply', ids.sam, '2026-03-01T01:00:00Z');
    return t;
  }

  const overview = async (q, user = admin) => (await user.get(`/api/analytics/overview?${q}`).expect(200)).body.data;

  describe('access', () => {
    it('is for admins only, enforced on the server', async () => {
      for (const path of ['overview', 'agents', 'export']) {
        await request(app).get(`/api/analytics/${path}`).expect(401);
        const res = await agent.get(`/api/analytics/${path}?${RANGE_A}`).expect(403);
        assert.equal(res.body.error.code, 'FORBIDDEN');
      }
      await admin.get(`/api/analytics/overview?${RANGE_A}`).expect(200);
    });

    it('validates the range', async () => {
      const details = async (q) => (await admin.get(`/api/analytics/overview?${q}`).expect(400)).body.error.details;
      assert.ok((await details('from=2026-02-30&to=2026-03-01')).from);
      assert.ok((await details('from=2026-03-01&to=yesterday')).to);
      assert.ok((await details('from=2026-03-02&to=2026-03-01')).from);
      assert.ok((await details('period=1y')).period);
      assert.ok((await details('period=7d&from=2026-03-01&to=2026-03-02')).period);
      assert.ok((await details('period=7d&tz=Mars/Olympus')).tz);
      assert.ok((await details('from=2020-01-01&to=2026-01-01')).to);
      assert.ok((await admin.get(`/api/analytics/export?${RANGE_A}&report=tickets`).expect(400)).body.error.details.report);
    });
  });

  it('returns zero-valued metrics for an empty database', async () => {
    const o = await overview(RANGE_A);
    assert.deepEqual(o.period, { created: 0, resolved: 0 });
    assert.equal(o.sla.compliancePercent, null);
    assert.equal(o.sla.averageFirstResponseSeconds, null);
    assert.deepEqual([o.sla.met, o.sla.breached, o.sla.pending, o.sla.notApplicable], [0, 0, 0, 0]);
    assert.deepEqual(o.resolution, { resolved: 0, averageSeconds: null, medianSeconds: null });
    assert.equal(o.current.total, 0);
    assert.deepEqual(o.trend, [
      { bucket: '2026-03-10T00:00', created: 0, resolved: 0 },
      { bucket: '2026-03-11T00:00', created: 0, resolved: 0 },
      { bucket: '2026-03-12T00:00', created: 0, resolved: 0 },
    ]);
    assert.ok(o.distribution.status.every((d) => d.count === 0 && d.percent === null));

    const { agents } = (await admin.get(`/api/analytics/agents?${RANGE_A}`).expect(200)).body.data;
    assert.equal(agents.length, 3);
    assert.ok(agents.every((a) => a.resolvedInPeriod === 0 && a.firstReplies === 0 && a.compliancePercent === null));
  });

  describe('with a fixed dataset', () => {
    beforeEach(seedRangeA);

    it('counts tickets created in the range, including both boundary days', async () => {
      const o = await overview(RANGE_A);
      assert.equal(o.period.created, 5, 'T2, T3, T4, T5, T7; not T1 (23:59:59 the day before) or T6 (00:00 the day after)');
      assert.deepEqual(o.range, { from: '2026-03-10', to: '2026-03-12', tz: 'UTC', period: 'custom', days: 3, granularity: 'day' });
      assert.equal((await overview('from=2026-03-10&to=2026-03-10&tz=UTC')).period.created, 2, 'T2 at 00:00:00 and T7');
      assert.equal((await overview('from=2026-03-12&to=2026-03-12&tz=UTC')).period.created, 1, 'T3 at 23:59:59.999');
    });

    it('applies the requested time zone to the day boundaries', async () => {
      // Asia/Kolkata is UTC+05:30: the range runs from 2026-03-09T18:30Z to 2026-03-12T18:30Z.
      const o = await overview('from=2026-03-10&to=2026-03-12&tz=Asia/Kolkata');
      assert.equal(o.period.created, 5, 'T1 moves in, T3 moves out');
    });

    it('measures first-response SLA over tickets created in the range', async () => {
      const { sla } = await overview(RANGE_A);
      assert.deepEqual(
        {
          met: sla.met,
          breached: sla.breached,
          breachedLateReply: sla.breachedLateReply,
          breachedNoReply: sla.breachedNoReply,
          pending: sla.pending,
          notApplicable: sla.notApplicable,
        },
        { met: 2, breached: 2, breachedLateReply: 1, breachedNoReply: 1, pending: 0, notApplicable: 1 },
        'met: T2, T7; late: T4; no reply (only a note): T3; resolved without reply: T5',
      );
      assert.equal(sla.compliancePercent, 50);
      assert.equal(sla.responded, 3);
      assert.equal(sla.averageFirstResponseSeconds, Math.round((1 + 5 + 0.5) * HOUR / 3), 'only replied tickets');
    });

    it('excludes tickets whose deadline has not passed from compliance', async () => {
      const fresh = (
        await agent.post('/api/tickets', { subject: 'Fresh', customerName: 'Jo', description: 'Just arrived' }).expect(201)
      ).body.data;
      const day = fresh.createdAt.slice(0, 10);
      const { sla } = await overview(`from=${day}&to=${day}&tz=UTC`);
      assert.deepEqual([sla.pending, sla.met, sla.breached, sla.compliancePercent], [1, 0, 0, null]);
    });

    it('measures resolution over tickets currently resolved in the range, without unresolved or reopened ones', async () => {
      const { resolution, period } = await overview(RANGE_A);
      assert.equal(period.resolved, 3, 'T2, T5 and T8 (created before the range); not T7, which was reopened');
      assert.equal(resolution.averageSeconds, Math.round((24 + 2 + 11.5 * 24) * HOUR / 3));
      assert.equal(resolution.medianSeconds, 24 * HOUR);
    });

    it('never averages negative durations', async () => {
      await ticket({ subject: 'Bad data', created: '2026-03-11T10:00:00Z', status: 'Resolved', resolvedAt: '2026-03-11T09:00:00Z' });
      const { resolution } = await overview(RANGE_A);
      assert.equal(resolution.resolved, 4);
      assert.equal(resolution.averageSeconds, Math.round((24 + 2 + 11.5 * 24) * HOUR / 3), 'the bad row is left out of the average');
    });

    it('reports current state across all tickets, whatever the range', async () => {
      const { current } = await overview('from=2026-01-01&to=2026-01-01&tz=UTC'); // nothing was created that day
      assert.equal(current.total, 8);
      assert.equal(current.open, 4, 'T1, T3, T6, T7');
      assert.equal(current.inProgress, 1);
      assert.equal(current.awaitingFirstReply, 3, 'T1, T3 (note only), T6');
      const dashboard = (await agent.get('/api/dashboard').expect(200)).body.data.counts;
      for (const key of Object.keys(dashboard)) assert.equal(current[key], dashboard[key], `${key} matches the dashboard`);
    });

    it('splits created tickets by current status and priority', async () => {
      const { distribution } = await overview(RANGE_A);
      const counts = (list) => Object.fromEntries(list.map((d) => [d.value, d.count]));
      assert.deepEqual(counts(distribution.status), { Open: 2, 'In Progress': 1, 'Waiting on Customer': 0, Resolved: 2 });
      assert.deepEqual(counts(distribution.priority), { Low: 1, Medium: 2, High: 1, Urgent: 1 });
      assert.equal(distribution.status.find((d) => d.value === 'Open').percent, 40);
      assert.equal(distribution.priority.reduce((sum, d) => sum + d.count, 0), 5);
    });

    it('buckets the trend by day and by hour', async () => {
      const daily = (await overview(RANGE_A)).trend;
      assert.deepEqual(daily, [
        { bucket: '2026-03-10T00:00', created: 2, resolved: 0 },
        { bucket: '2026-03-11T00:00', created: 2, resolved: 2 },
        { bucket: '2026-03-12T00:00', created: 1, resolved: 1 },
      ]);
      const hourly = await overview('from=2026-03-11&to=2026-03-11&tz=UTC');
      assert.equal(hourly.range.granularity, 'hour');
      assert.equal(hourly.trend.length, 24);
      assert.deepEqual(
        hourly.trend.filter((b) => b.created || b.resolved),
        [
          { bucket: '2026-03-11T00:00', created: 0, resolved: 1 },
          { bucket: '2026-03-11T10:00', created: 1, resolved: 0 },
          { bucket: '2026-03-11T12:00', created: 1, resolved: 0 },
          { bucket: '2026-03-11T14:00', created: 0, resolved: 1 },
        ],
      );
      const weekly = await overview('from=2026-01-01&to=2026-03-31&tz=UTC');
      assert.equal(weekly.range.granularity, 'week');
      assert.equal(weekly.trend.reduce((sum, b) => sum + b.created, 0), weekly.period.created);
    });

    it('attributes first replies to their author and resolutions to the current assignee', async () => {
      const { agents } = (await admin.get(`/api/analytics/agents?${RANGE_A}`).expect(200)).body.data;
      const by = Object.fromEntries(agents.map((a) => [a.name, a]));
      assert.deepEqual(
        Object.keys(by[`Priya Agent`]).sort(),
        [
          'averageFirstResponseSeconds',
          'averageResolutionSeconds',
          'compliancePercent',
          'firstReplies',
          'firstRepliesLate',
          'firstRepliesOnTime',
          'id',
          'name',
          'openAssignedNow',
          'resolvedInPeriod',
          'role',
        ],
        'no email or other personal data',
      );
      assert.deepEqual(
        [by['Priya Agent'].firstReplies, by['Priya Agent'].firstRepliesOnTime, by['Priya Agent'].openAssignedNow, by['Priya Agent'].resolvedInPeriod],
        [1, 1, 1, 1],
      );
      assert.equal(by['Priya Agent'].averageResolutionSeconds, 24 * HOUR);
      assert.deepEqual(
        [by['Sam Agent'].firstReplies, by['Sam Agent'].firstRepliesLate, by['Sam Agent'].compliancePercent, by['Sam Agent'].resolvedInPeriod],
        [1, 1, 0, 1],
        'the note on T3 does not count; T8 was resolved in range while assigned to Sam',
      );
      assert.equal(by['Alex Admin'].firstRepliesOnTime, 1);

      const { sla } = await overview(RANGE_A);
      assert.equal(agents.reduce((s, a) => s + a.firstRepliesOnTime, 0), sla.met);
      assert.equal(agents.reduce((s, a) => s + a.firstRepliesLate, 0), sla.breachedLateReply);
    });

    describe('CSV export', () => {
      const exportCsv = async (q) => {
        const res = await admin.get(`/api/analytics/export?${q}`).expect(200);
        assert.match(res.headers['content-type'], /^text\/csv/);
        return res;
      };
      const rowsOf = (text) => text.trimEnd().split('\r\n');

      it('exports the summary for the requested range with a descriptive filename', async () => {
        const res = await exportCsv(`${RANGE_A}&report=summary`);
        assert.equal(res.headers['content-disposition'], 'attachment; filename="comhord-analytics-summary-2026-03-10_to_2026-03-12.csv"');
        const rows = rowsOf(res.text);
        assert.equal(rows[0], 'section,metric,value,definition');
        assert.ok(rows.some((r) => r.startsWith('created_in_period,tickets_created,5,')));
        assert.ok(rows.some((r) => r.startsWith('created_in_period,sla_compliance_percent,50,')));
        assert.ok(!res.text.includes('customer@example.com'));

        const narrower = await exportCsv('from=2026-03-10&to=2026-03-10&tz=UTC&report=summary');
        assert.ok(rowsOf(narrower.text).some((r) => r.startsWith('created_in_period,tickets_created,2,')));
      });

      it('exports the trend and agent reports', async () => {
        assert.deepEqual(rowsOf((await exportCsv(`${RANGE_A}&report=trend`)).text), [
          'day_start (UTC),tickets_created,tickets_resolved',
          '2026-03-10,2,0',
          '2026-03-11,2,2',
          '2026-03-12,1,1',
        ]);
        const agentsCsv = rowsOf((await exportCsv(`${RANGE_A}&report=agents`)).text);
        assert.equal(agentsCsv.length, 4);
        assert.ok(agentsCsv.includes('Priya Agent,agent,1,1,24,1,1,0,100,60'));
      });

      it('neutralises spreadsheet formulas in exported text', async () => {
        await query(`UPDATE users SET name = '=HYPERLINK("http://evil.example","x")' WHERE id = $1`, [ids.sam]);
        const text = (await exportCsv(`${RANGE_A}&report=agents`)).text;
        assert.ok(text.includes(`"'=HYPERLINK(""http://evil.example"",""x"")"`));
        assert.ok(!/(^|\r\n)=/.test(text));
      });
    });
  });
});
