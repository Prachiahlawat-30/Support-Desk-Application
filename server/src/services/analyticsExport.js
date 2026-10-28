import { toCsv } from '../utils/csv.js';
import { getAgentAnalytics, getOverview } from './analyticsService.js';

// CSV versions of the analytics reports. Only aggregates and agent names are exported:
// no customer data, ticket text or credentials.

const hours = (s) => (s === null ? null : Math.round((s / 3600) * 10) / 10);
const minutes = (s) => (s === null ? null : Math.round((s / 60) * 10) / 10);

function summaryRows(o) {
  const rangeNote = `${o.range.from} to ${o.range.to} (${o.range.tz})`;
  return [
    ['section', 'metric', 'value', 'definition'],
    ['range', 'from', o.range.from, 'Inclusive start date'],
    ['range', 'to', o.range.to, 'Inclusive end date'],
    ['range', 'time_zone', o.range.tz, 'Days start at 00:00 in this time zone'],
    ['created_in_period', 'tickets_created', o.period.created, `Tickets created ${rangeNote}`],
    ['created_in_period', 'sla_met', o.sla.met, 'First public reply at or before the deadline'],
    ['created_in_period', 'sla_breached', o.sla.breached, 'First public reply after the deadline, or none and the deadline has passed'],
    ['created_in_period', 'sla_breached_late_reply', o.sla.breachedLateReply, 'Breached: replied after the deadline'],
    ['created_in_period', 'sla_breached_no_reply', o.sla.breachedNoReply, 'Breached: no reply yet, deadline passed'],
    ['created_in_period', 'sla_pending', o.sla.pending, 'No reply yet, deadline not reached (excluded from compliance)'],
    ['created_in_period', 'sla_not_applicable', o.sla.notApplicable, 'Resolved without a public reply (excluded from compliance)'],
    ['created_in_period', 'sla_compliance_percent', o.sla.compliancePercent, 'met / (met + breached) x 100; empty when there is no outcome yet'],
    ['created_in_period', 'avg_first_response_minutes', minutes(o.sla.averageFirstResponseSeconds), 'Average time to the first public reply, replied tickets only'],
    ['resolved_in_period', 'tickets_resolved', o.resolution.resolved, `Tickets whose current resolution happened ${rangeNote}`],
    ['resolved_in_period', 'avg_resolution_hours', hours(o.resolution.averageSeconds), 'Creation to most recent resolution'],
    ['resolved_in_period', 'median_resolution_hours', hours(o.resolution.medianSeconds), 'Creation to most recent resolution'],
    ['current', 'open', o.current.open, 'All tickets, right now'],
    ['current', 'in_progress', o.current.inProgress, 'All tickets, right now'],
    ['current', 'waiting_on_customer', o.current.waitingOnCustomer, 'All tickets, right now'],
    ['current', 'unassigned', o.current.unassigned, 'Unresolved tickets without an assignee, right now'],
    ['current', 'sla_breached', o.current.slaBreached, 'Unresolved tickets with a breached first-response SLA, right now'],
    ['current', 'sla_reply_due_soon', o.current.slaDue, 'No public reply, deadline within the hour, right now'],
    ['current', 'awaiting_first_reply', o.current.awaitingFirstReply, 'Unresolved tickets without a public reply, right now'],
    ...o.distribution.status.map((d) => ['created_in_period_by_status', d.value, d.count, 'Current status of tickets created in the period']),
    ...o.distribution.priority.map((d) => ['created_in_period_by_priority', d.value, d.count, 'Current priority of tickets created in the period']),
  ];
}

function trendRows(o) {
  return [
    [`${o.range.granularity}_start (${o.range.tz})`, 'tickets_created', 'tickets_resolved'],
    ...o.trend.map((b) => [o.range.granularity === 'hour' ? b.bucket : b.bucket.slice(0, 10), b.created, b.resolved]),
  ];
}

function agentRows(a) {
  return [
    [
      'agent',
      'role',
      'open_assigned_now',
      'resolved_in_period_current_assignee',
      'avg_resolution_hours',
      'first_replies_to_tickets_created_in_period',
      'first_replies_on_time',
      'first_replies_late',
      'sla_compliance_percent',
      'avg_first_response_minutes',
    ],
    ...a.agents.map((x) => [
      x.name,
      x.role,
      x.openAssignedNow,
      x.resolvedInPeriod,
      hours(x.averageResolutionSeconds),
      x.firstReplies,
      x.firstRepliesOnTime,
      x.firstRepliesLate,
      x.compliancePercent,
      minutes(x.averageFirstResponseSeconds),
    ]),
  ];
}

/** Returns `{ filename, csv }` for one report over `range`. */
export async function buildCsvReport(range, report) {
  const rows =
    report === 'agents'
      ? agentRows(await getAgentAnalytics(range))
      : report === 'trend'
        ? trendRows(await getOverview(range))
        : summaryRows(await getOverview(range));
  return { filename: `comhord-analytics-${report}-${range.from}_to_${range.to}.csv`, csv: toCsv(rows) };
}
