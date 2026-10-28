import { config } from '../config.js';
import { query } from '../db/pool.js';
import { OVERDUE_HOURS, RESOLVED } from '../domain/constants.js';
import {
  escalationActiveSql,
  escalationColumnsSql,
  escalationJoinSql,
  overdueSql,
  slaBreachedSql,
  slaColumnsSql,
  slaUrgencySql,
} from '../domain/rules.js';
import { toTicket } from './mappers.js';

const OVERDUE_LIST_LIMIT = 10;

/**
 * Live counts of all tickets as they are right now (not limited to any date range).
 * Shared by the dashboard and the analytics page, so both always show the same numbers.
 */
export async function getCurrentCounts() {
  const { rows } = await query(`
    SELECT
      count(*)::int                                                      AS total,
      count(*) FILTER (WHERE status = 'Open')::int                       AS open,
      count(*) FILTER (WHERE status = 'In Progress')::int                AS in_progress,
      count(*) FILTER (WHERE status = 'Waiting on Customer')::int        AS waiting_on_customer,
      count(*) FILTER (WHERE status = '${RESOLVED}')::int                AS resolved,
      count(*) FILTER (WHERE priority = 'Urgent' AND status <> '${RESOLVED}')::int AS urgent,
      count(*) FILTER (WHERE ${overdueSql('t')})::int                    AS overdue,
      count(*) FILTER (WHERE ${slaBreachedSql(config.slaFirstResponseHours, 't')} AND status <> '${RESOLVED}')::int
                                                                         AS sla_breached,
      count(*) FILTER (WHERE ${slaUrgencySql(config.slaFirstResponseHours, 't')} IN ('approaching', 'critical'))::int
                                                                         AS sla_due,
      count(*) FILTER (WHERE assignee_id IS NULL AND status <> '${RESOLVED}')::int AS unassigned,
      count(*) FILTER (WHERE ${escalationActiveSql(config.slaFirstResponseHours, 1, 't')})::int AS escalated,
      count(*) FILTER (WHERE ${escalationActiveSql(config.slaFirstResponseHours, 2, 't')})::int AS escalated_level2
    FROM tickets t`);
  const c = rows[0];
  return {
    total: c.total,
    open: c.open,
    inProgress: c.in_progress,
    waitingOnCustomer: c.waiting_on_customer,
    resolved: c.resolved,
    urgent: c.urgent,
    overdue: c.overdue,
    slaBreached: c.sla_breached,
    slaDue: c.sla_due,
    unassigned: c.unassigned,
    escalated: c.escalated,
    escalatedLevel2: c.escalated_level2,
  };
}

/** All counts are computed from the saved tickets on every request. */
export async function getDashboard() {
  const overdueQuery = query(
    `SELECT t.*, a.name AS assignee_name, true AS is_overdue,
            ${slaColumnsSql(config.slaFirstResponseHours, 't')},
            ${escalationColumnsSql(config.slaFirstResponseHours, 't')}
     FROM tickets t LEFT JOIN users a ON a.id = t.assignee_id
     ${escalationJoinSql('t')}
     WHERE ${overdueSql('t')}
     ORDER BY t.created_at ASC
     LIMIT $1`,
    [OVERDUE_LIST_LIMIT],
  );

  const [counts, overdue] = await Promise.all([getCurrentCounts(), overdueQuery]);
  return {
    counts,
    overdueTickets: overdue.rows.map(toTicket),
    rules: {
      overdueHours: OVERDUE_HOURS,
      slaFirstResponseHours: config.slaFirstResponseHours,
      escalationLevel2Hours: config.escalation.level2Hours,
    },
  };
}
