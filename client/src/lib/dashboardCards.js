import { STATUSES } from './constants.js';

// Dashboard cards and the ticket-list filter each one links to. Every link must select
// exactly the tickets its count includes; the server integration tests check this
// against the real API, so keep this file free of JSX and browser-only code.

/** Every status except Resolved, as a comma list for the `status` filter. */
export const UNRESOLVED = STATUSES.filter((s) => s !== 'Resolved').join(',');

export function ticketsLink(filters = {}) {
  const query = new URLSearchParams(filters).toString();
  return query ? `/tickets?${query}` : '/tickets';
}

export const STATUS_CARDS = [
  { key: 'total', label: 'Total tickets', to: ticketsLink() },
  { key: 'open', label: 'Open', to: ticketsLink({ status: 'Open' }), tone: 'open' },
  { key: 'inProgress', label: 'In progress', to: ticketsLink({ status: 'In Progress' }), tone: 'in-progress' },
  {
    key: 'waitingOnCustomer',
    label: 'Waiting on customer',
    to: ticketsLink({ status: 'Waiting on Customer' }),
    tone: 'waiting',
  },
  { key: 'resolved', label: 'Resolved', to: ticketsLink({ status: 'Resolved' }), tone: 'resolved' },
];

/**
 * Operational metrics. All of them count unresolved tickets only. "SLA breached" also counts
 * tickets answered late; the escalation cards count only tickets still waiting for a reply.
 */
export const ATTENTION_CARDS = [
  {
    key: 'urgent',
    group: 'queue',
    label: 'Urgent',
    hint: () => 'Urgent priority, not resolved',
    to: ticketsLink({ priority: 'Urgent', status: UNRESOLVED }),
    tone: 'urgent',
  },
  {
    key: 'overdue',
    group: 'queue',
    label: 'Overdue',
    hint: (rules) => `Not resolved, created over ${rules.overdueHours}h ago`,
    to: ticketsLink({ overdue: 'true' }),
    tone: 'overdue',
  },
  {
    key: 'slaBreached',
    group: 'sla',
    label: 'SLA breached',
    hint: (rules) => `Not resolved, first reply missed ${rules.slaFirstResponseHours}h target`,
    to: ticketsLink({ slaBreached: 'true', status: UNRESOLVED }),
    tone: 'sla',
  },
  {
    key: 'slaDue',
    group: 'sla',
    label: 'Reply due soon',
    hint: () => 'No public reply, SLA deadline within the hour',
    to: ticketsLink({ slaDue: 'true' }),
    tone: 'sla-due',
  },
  {
    key: 'escalated',
    group: 'escalation',
    label: 'Escalated',
    hint: () => 'SLA breached and still no public reply',
    to: ticketsLink({ escalation: 'active' }),
    tone: 'escalated',
  },
  {
    key: 'escalatedLevel2',
    group: 'escalation',
    label: 'Senior attention',
    hint: (rules) => `No public reply ${rules.escalationLevel2Hours}h after the deadline`,
    to: ticketsLink({ escalation: 'level2' }),
    tone: 'senior',
  },
  {
    key: 'unassigned',
    group: 'queue',
    label: 'Unassigned',
    hint: () => 'Not resolved, no agent assigned',
    to: ticketsLink({ assignee: 'unassigned', status: UNRESOLVED }),
    tone: 'unassigned',
  },
];
