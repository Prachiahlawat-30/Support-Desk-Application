import { config } from '../config.js';
import { query } from '../db/pool.js';
import { PRIORITIES, RESOLVED, STATUSES } from '../domain/constants.js';
import { slaUrgencySql } from '../domain/rules.js';
import { badRequest } from '../utils/httpError.js';
import { getCurrentCounts } from './dashboardService.js';

// Support analytics. Every figure is one SQL aggregate over saved data; no ticket rows or
// message bodies are loaded into JavaScript, and nothing is cached.
//
// Three kinds of figure, never mixed in one number:
// - "created in period": tickets whose created_at falls in the range (the SLA cohort);
// - "resolved in period": tickets whose current resolved_at falls in the range;
// - "current": the state of all tickets right now, whatever the range.
//
// Query parameters: $1 = from (date), $2 = to (date, inclusive), $3 = IANA time zone.

const RANGE_CTE = `p AS (
  SELECT ($1::date)::timestamp AT TIME ZONE $3::text AS start_at,
         ($2::date + 1)::timestamp AT TIME ZONE $3::text AS end_at
)`;
const CREATED_IN = '(t.created_at >= p.start_at AND t.created_at < p.end_at)';
const RESOLVED_IN = `(t.status = '${RESOLVED}' AND t.resolved_at >= p.start_at AND t.resolved_at < p.end_at)`;
const AWAITING = `('on_track', 'approaching', 'critical', 'breached')`;
const PENDING = `('on_track', 'approaching', 'critical')`;

const rangeParams = (range) => [range.from, range.to, range.tz];
const seconds = (value) => (value === null || value === undefined ? null : Math.round(Number(value)));
const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Postgres must know the zone too; Intl and Postgres zone lists differ slightly. */
async function assertKnownTimeZone(tz) {
  const { rowCount } = await query('SELECT 1 FROM pg_timezone_names WHERE name = $1', [tz]);
  if (rowCount === 0) throw badRequest(`Unknown time zone: ${tz}`, { tz: 'Time zone is not supported' });
}

/** Tickets with their SLA urgency, from the single SLA rule in domain/rules.js. */
const TICKETS_WITH_SLA = `SELECT t.*, ${slaUrgencySql(config.slaFirstResponseHours, 't')} AS urgency FROM tickets t`;

async function periodFigures(range) {
  const { rows } = await query(
    `WITH ${RANGE_CTE}
     SELECT
       count(*) FILTER (WHERE ${CREATED_IN})::int AS created,
       count(*) FILTER (WHERE ${CREATED_IN} AND t.urgency = 'responded_on_time')::int AS sla_met,
       count(*) FILTER (WHERE ${CREATED_IN} AND t.urgency = 'responded_late')::int AS sla_late_reply,
       count(*) FILTER (WHERE ${CREATED_IN} AND t.urgency = 'breached')::int AS sla_no_reply,
       count(*) FILTER (WHERE ${CREATED_IN} AND t.urgency IN ${PENDING})::int AS sla_pending,
       count(*) FILTER (WHERE ${CREATED_IN} AND t.urgency = 'not_applicable')::int AS sla_not_applicable,
       count(*) FILTER (WHERE ${CREATED_IN} AND t.first_response_at >= t.created_at)::int AS responded,
       avg(extract(epoch FROM t.first_response_at - t.created_at))
         FILTER (WHERE ${CREATED_IN} AND t.first_response_at >= t.created_at)::float8 AS avg_first_response_s,
       count(*) FILTER (WHERE ${RESOLVED_IN})::int AS resolved,
       avg(extract(epoch FROM t.resolved_at - t.created_at))
         FILTER (WHERE ${RESOLVED_IN} AND t.resolved_at >= t.created_at)::float8 AS avg_resolution_s,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM t.resolved_at - t.created_at))
         FILTER (WHERE ${RESOLVED_IN} AND t.resolved_at >= t.created_at) AS median_resolution_s,
       count(*) FILTER (WHERE t.urgency IN ${AWAITING})::int AS awaiting_first_reply
     FROM (${TICKETS_WITH_SLA}) t CROSS JOIN p`,
    rangeParams(range),
  );
  return rows[0];
}

/** Created and resolved counts per bucket, with empty buckets as zero. Bucket starts are local times. */
async function trend(range) {
  const { rows } = await query(
    `WITH ${RANGE_CTE},
     series AS (
       SELECT generate_series(
         date_trunc($4::text, $1::date::timestamp),
         $2::date::timestamp + interval '1 day' - interval '1 microsecond',
         ('1 ' || $4::text)::interval
       ) AS bucket
     ),
     created AS (
       SELECT date_trunc($4::text, t.created_at AT TIME ZONE $3::text) AS bucket, count(*)::int AS n
       FROM tickets t CROSS JOIN p WHERE ${CREATED_IN} GROUP BY 1
     ),
     resolved AS (
       SELECT date_trunc($4::text, t.resolved_at AT TIME ZONE $3::text) AS bucket, count(*)::int AS n
       FROM tickets t CROSS JOIN p WHERE ${RESOLVED_IN} GROUP BY 1
     )
     SELECT to_char(s.bucket, 'YYYY-MM-DD"T"HH24:MI') AS bucket,
            coalesce(c.n, 0) AS created, coalesce(r.n, 0) AS resolved
     FROM series s
     LEFT JOIN created c ON c.bucket = s.bucket
     LEFT JOIN resolved r ON r.bucket = s.bucket
     ORDER BY s.bucket`,
    [...rangeParams(range), range.granularity],
  );
  return rows;
}

/** Tickets created in the period, by their current status and priority. */
async function distribution(range, created) {
  const { rows } = await query(
    `WITH ${RANGE_CTE}
     SELECT t.status, t.priority, count(*)::int AS n
     FROM tickets t CROSS JOIN p
     WHERE ${CREATED_IN}
     GROUP BY GROUPING SETS ((t.status), (t.priority))`,
    rangeParams(range),
  );
  const count = (field, value) => rows.find((r) => r[field] === value && r[field === 'status' ? 'priority' : 'status'] === null)?.n ?? 0;
  const shape = (field, values) =>
    values.map((value) => {
      const n = count(field, value);
      return { value, count: n, percent: percent(n, created) };
    });
  return { status: shape('status', STATUSES), priority: shape('priority', PRIORITIES) };
}

export async function getOverview(range) {
  await assertKnownTimeZone(range.tz);
  const [p, buckets, current] = await Promise.all([periodFigures(range), trend(range), getCurrentCounts()]);
  const breached = p.sla_late_reply + p.sla_no_reply;
  return {
    range,
    period: { created: p.created, resolved: p.resolved },
    sla: {
      targetHours: config.slaFirstResponseHours,
      met: p.sla_met,
      breached,
      breachedLateReply: p.sla_late_reply,
      breachedNoReply: p.sla_no_reply,
      pending: p.sla_pending,
      notApplicable: p.sla_not_applicable,
      compliancePercent: percent(p.sla_met, p.sla_met + breached),
      responded: p.responded,
      averageFirstResponseSeconds: seconds(p.avg_first_response_s),
    },
    resolution: {
      resolved: p.resolved,
      averageSeconds: seconds(p.avg_resolution_s),
      medianSeconds: seconds(p.median_resolution_s),
    },
    current: { ...current, awaitingFirstReply: p.awaiting_first_reply },
    trend: buckets,
    distribution: await distribution(range, p.created),
  };
}

/**
 * Per-agent figures. Resolutions are credited to the ticket's *current* assignee (the
 * assignment history stores names, not ids, so past assignees can't be identified
 * reliably). First replies are credited to the author of the ticket's first public reply,
 * which is exact. Every user is listed, including those with no tickets.
 */
export async function getAgentAnalytics(range) {
  await assertKnownTimeZone(range.tz);
  const { rows } = await query(
    `WITH ${RANGE_CTE},
     first_replies AS (
       SELECT DISTINCT ON (m.ticket_id) m.ticket_id, m.author_id
       FROM ticket_messages m
       WHERE m.kind = 'reply'
       ORDER BY m.ticket_id, m.created_at, m.id
     ),
     assigned AS (
       SELECT t.assignee_id AS user_id,
              count(*) FILTER (WHERE t.status <> '${RESOLVED}')::int AS open_now,
              count(*) FILTER (WHERE ${RESOLVED_IN})::int AS resolved,
              avg(extract(epoch FROM t.resolved_at - t.created_at))
                FILTER (WHERE ${RESOLVED_IN} AND t.resolved_at >= t.created_at)::float8 AS avg_resolution_s
       FROM tickets t CROSS JOIN p
       WHERE t.assignee_id IS NOT NULL
       GROUP BY t.assignee_id
     ),
     replied AS (
       SELECT fr.author_id AS user_id,
              count(*)::int AS first_replies,
              count(*) FILTER (WHERE t.urgency = 'responded_on_time')::int AS met,
              count(*) FILTER (WHERE t.urgency = 'responded_late')::int AS late,
              avg(extract(epoch FROM t.first_response_at - t.created_at))
                FILTER (WHERE t.first_response_at >= t.created_at)::float8 AS avg_first_response_s
       FROM (${TICKETS_WITH_SLA}) t
       CROSS JOIN p
       JOIN first_replies fr ON fr.ticket_id = t.id
       WHERE ${CREATED_IN} AND t.first_response_at IS NOT NULL
       GROUP BY fr.author_id
     )
     SELECT u.id, u.name, u.role,
            coalesce(a.open_now, 0) AS open_now, coalesce(a.resolved, 0) AS resolved, a.avg_resolution_s,
            coalesce(r.first_replies, 0) AS first_replies, coalesce(r.met, 0) AS met, coalesce(r.late, 0) AS late,
            r.avg_first_response_s
     FROM users u
     LEFT JOIN assigned a ON a.user_id = u.id
     LEFT JOIN replied r ON r.user_id = u.id
     ORDER BY u.name, u.id`,
    rangeParams(range),
  );
  return {
    range,
    agents: rows.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.role,
      openAssignedNow: r.open_now,
      resolvedInPeriod: r.resolved,
      averageResolutionSeconds: seconds(r.avg_resolution_s),
      firstReplies: r.first_replies,
      firstRepliesOnTime: r.met,
      firstRepliesLate: r.late,
      compliancePercent: percent(r.met, r.met + r.late),
      averageFirstResponseSeconds: seconds(r.avg_first_response_s),
    })),
  };
}
