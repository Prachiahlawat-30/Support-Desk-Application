import { LIMITS, PRIORITIES, SORTS, STATUSES } from '../domain/constants.js';

const ESCALATION_FILTERS = ['active', 'level2'];

// Accepts `?status=Open,Resolved` as well as repeated `?status=Open&status=Resolved`.
function list(raw) {
  if (raw === undefined || raw === '') return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  return parts
    .flatMap((p) => String(p).split(','))
    .map((p) => p.trim())
    .filter(Boolean);
}

function positiveInt(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

/**
 * Turns the ticket list query string into a filter object.
 * `assignee` may be an agent id, `me` (the current user) or `unassigned`.
 * `overdue`, `slaBreached` and `escalation` apply the same rules as the dashboard counts.
 */
export function parseTicketListQuery(query, currentUser) {
  const errors = {};

  const search = typeof query.search === 'string' ? query.search.trim().slice(0, LIMITS.search) : '';

  const statuses = list(query.status);
  if (statuses.some((s) => !STATUSES.includes(s))) errors.status = `Status must be one of: ${STATUSES.join(', ')}`;

  const priorities = list(query.priority);
  if (priorities.some((p) => !PRIORITIES.includes(p))) {
    errors.priority = `Priority must be one of: ${PRIORITIES.join(', ')}`;
  }

  let assigneeId = null;
  let unassigned = false;
  const assignee = typeof query.assignee === 'string' ? query.assignee.trim() : '';
  if (assignee === 'unassigned') unassigned = true;
  else if (assignee === 'me') assigneeId = currentUser.id;
  else if (assignee) {
    assigneeId = positiveInt(assignee);
    if (Number.isNaN(assigneeId)) errors.assignee = 'Assignee must be an agent id, "me" or "unassigned"';
  }

  const overdue = query.overdue === 'true' || query.overdue === '1';
  const slaBreached = query.slaBreached === 'true' || query.slaBreached === '1';
  // First public reply due within the hour (SLA approaching or critical).
  const slaDue = query.slaDue === 'true' || query.slaDue === '1';

  // `active`: any active escalation; `level2`: active and at the senior-attention stage.
  const escalation = typeof query.escalation === 'string' && query.escalation ? query.escalation : null;
  if (escalation && !ESCALATION_FILTERS.includes(escalation)) {
    errors.escalation = `Escalation must be one of: ${ESCALATION_FILTERS.join(', ')}`;
  }

  const sort = query.sort || 'updated';
  if (!SORTS.includes(sort)) errors.sort = `Sort must be one of: ${SORTS.join(', ')}`;

  const page = positiveInt(query.page, 1);
  if (Number.isNaN(page)) errors.page = 'Page must be a positive integer';
  const pageSize = positiveInt(query.pageSize, LIMITS.defaultPageSize);
  if (Number.isNaN(pageSize) || pageSize > LIMITS.maxPageSize) {
    errors.pageSize = `Page size must be between 1 and ${LIMITS.maxPageSize}`;
  }

  return {
    value: { search, statuses, priorities, assigneeId, unassigned, overdue, slaBreached, slaDue, escalation, sort, page, pageSize },
    errors: Object.keys(errors).length ? errors : null,
  };
}
