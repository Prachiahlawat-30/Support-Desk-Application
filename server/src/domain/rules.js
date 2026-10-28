import { OVERDUE_HOURS, PRIORITIES, RESOLVED, SLA_APPROACHING_MINUTES, SLA_CRITICAL_MINUTES } from './constants.js';

// Business rules expressed as SQL fragments, so that list filters, ticket flags and
// dashboard counts all evaluate the rule in exactly one place, against saved data.
// Interpolated values are internal constants/config numbers, never user input.

/** Not Resolved and created more than OVERDUE_HOURS ago. */
export function overdueSql(alias = 't') {
  return `(${alias}.status <> '${RESOLVED}' AND ${alias}.created_at < now() - interval '${OVERDUE_HOURS} hours')`;
}

/** First-response deadline: creation time plus the SLA target. */
export function slaDeadlineSql(slaHours, alias = 't') {
  return `(${alias}.created_at + interval '1 hour' * ${Number(slaHours)})`;
}

/**
 * First-response SLA urgency, the single definition every SLA value derives from:
 * - responded_on_time / responded_late: a public reply exists, sent at/before or after the deadline
 *   (this stays the ticket's historical result, also after it is resolved);
 * - not_applicable: resolved before any public reply, so no countdown runs;
 * - breached: no public reply and the deadline has been reached (exactly at the deadline counts);
 * - critical: at most SLA_CRITICAL_MINUTES left; approaching: at most SLA_APPROACHING_MINUTES left;
 * - on_track: more time left than that.
 * `now` is a SQL expression so tests can evaluate exact boundaries; it is never user input.
 */
export function slaUrgencySql(slaHours, alias = 't', now = 'now()') {
  const deadline = slaDeadlineSql(slaHours, alias);
  return `(CASE
    WHEN ${alias}.first_response_at IS NOT NULL AND ${alias}.first_response_at <= ${deadline} THEN 'responded_on_time'
    WHEN ${alias}.first_response_at IS NOT NULL THEN 'responded_late'
    WHEN ${alias}.status = '${RESOLVED}' THEN 'not_applicable'
    WHEN ${now} >= ${deadline} THEN 'breached'
    WHEN ${deadline} - ${now} <= interval '${SLA_CRITICAL_MINUTES} minutes' THEN 'critical'
    WHEN ${deadline} - ${now} <= interval '${SLA_APPROACHING_MINUTES} minutes' THEN 'approaching'
    ELSE 'on_track'
  END)`;
}

/**
 * SLA breach: the first public reply came after the deadline, or the ticket is still
 * unresolved without a public reply and the deadline has been reached.
 */
export function slaBreachedSql(slaHours, alias = 't', now = 'now()') {
  return `(${slaUrgencySql(slaHours, alias, now)} IN ('responded_late', 'breached'))`;
}

/**
 * Seconds until the deadline (negative once breached) while a countdown is running,
 * otherwise NULL. Rounded up, so comparing it with the minute thresholds gives the same
 * urgency as slaUrgencySql.
 */
export function slaRemainingSecondsSql(slaHours, alias = 't', now = 'now()') {
  return `(CASE WHEN ${alias}.first_response_at IS NULL AND ${alias}.status <> '${RESOLVED}'
    THEN ceil(extract(epoch FROM ${slaDeadlineSql(slaHours, alias)} - ${now}))::int END)`;
}

/**
 * Whether a ticket has reached an escalation stage at `now`. Both stages build on the SLA
 * rule above, so only tickets still waiting for their first public reply qualify:
 * stage 1 as soon as the SLA is breached, stage 2 once it is still breached
 * `level2Hours` after the deadline (exactly then counts).
 */
export function escalationDueSql(stage, slaHours, level2Hours, alias = 't', now = 'now()') {
  const breached = `(${slaUrgencySql(slaHours, alias, now)} = 'breached')`;
  if (Number(stage) === 1) return breached;
  return `(${breached} AND ${now} >= ${slaDeadlineSql(slaHours, alias)} + interval '1 hour' * ${Number(level2Hours)})`;
}

/**
 * An escalation is active while it is recorded at `minStage` or higher and the ticket is
 * still waiting for its first public reply. A reply (even a late one) or resolving the
 * ticket ends it; reopening an unanswered ticket makes it active again.
 */
export function escalationActiveSql(slaHours, minStage = 1, alias = 't', now = 'now()') {
  return `(EXISTS (SELECT 1 FROM ticket_escalations e WHERE e.ticket_id = ${alias}.id AND e.stage >= ${Number(minStage)})
    AND ${slaUrgencySql(slaHours, alias, now)} = 'breached')`;
}

/** Joins the ticket's highest recorded escalation as `esc`, for escalationColumnsSql. */
export function escalationJoinSql(alias = 't') {
  return `LEFT JOIN LATERAL (
    SELECT e.stage, e.rule, e.escalated_at, e.acknowledged_at, u.name AS acknowledged_by_name
    FROM ticket_escalations e LEFT JOIN users u ON u.id = e.acknowledged_by
    WHERE e.ticket_id = ${alias}.id
    ORDER BY e.stage DESC
    LIMIT 1
  ) esc ON true`;
}

/** The escalation columns added to every ticket row, mapped to `ticket.escalation` by toTicket. */
export function escalationColumnsSql(slaHours, alias = 't') {
  return `esc.stage AS escalation_stage,
         esc.rule AS escalation_rule,
         esc.escalated_at AS escalation_escalated_at,
         esc.acknowledged_at AS escalation_acknowledged_at,
         esc.acknowledged_by_name AS escalation_acknowledged_by_name,
         ${escalationActiveSql(slaHours, 1, alias)} AS escalation_active`;
}

/** The SLA columns added to every ticket row, mapped to `ticket.sla` by toTicket. */
export function slaColumnsSql(slaHours, alias = 't', now = 'now()') {
  return `${slaUrgencySql(slaHours, alias, now)} AS sla_urgency,
         ${slaDeadlineSql(slaHours, alias)} AS sla_deadline,
         ${slaRemainingSecondsSql(slaHours, alias, now)} AS sla_remaining_seconds,
         ${Number(slaHours)}::float8 AS sla_target_hours,
         ${slaBreachedSql(slaHours, alias, now)} AS sla_breached`;
}

/** Low = 1 ... Urgent = 4, used for "sort by priority". */
export function priorityRankSql(alias = 't') {
  const cases = PRIORITIES.map((p, i) => `WHEN '${p}' THEN ${i + 1}`).join(' ');
  return `(CASE ${alias}.priority ${cases} END)`;
}
