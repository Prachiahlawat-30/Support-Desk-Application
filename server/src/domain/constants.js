export const STATUSES = ['Open', 'In Progress', 'Waiting on Customer', 'Resolved'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const MESSAGE_KINDS = ['reply', 'note'];
export const ROLES = ['admin', 'agent'];

export const RESOLVED = 'Resolved';

/** A ticket is overdue when it is not Resolved and was created more than this many hours ago. */
export const OVERDUE_HOURS = 24;

/** First-response SLA countdown thresholds (minutes left before the deadline). */
export const SLA_APPROACHING_MINUTES = 60;
export const SLA_CRITICAL_MINUTES = 15;

/** SLA escalation stages, stored in ticket_escalations.stage. */
export const ESCALATION_STAGES = {
  1: { rule: 'first_response_sla_breached', label: 'Escalated' },
  2: { rule: 'first_response_still_missing', label: 'Senior attention' },
};

export const SORTS = ['updated', 'priority', 'created'];

export const EVENT_TYPES = {
  CREATED: 'created',
  STATUS_CHANGED: 'status_changed',
  PRIORITY_CHANGED: 'priority_changed',
  ASSIGNEE_CHANGED: 'assignee_changed',
  FIELD_UPDATED: 'field_updated',
  REPLY_ADDED: 'reply_added',
  NOTE_ADDED: 'note_added',
};

export const LIMITS = {
  subject: 200,
  customerName: 120,
  customerEmail: 254,
  description: 10_000,
  messageBody: 10_000,
  search: 200,
  maxPageSize: 100,
  defaultPageSize: 20,
};
