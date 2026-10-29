import { useNow } from '../hooks/useNow.js';
import { slug } from '../lib/constants.js';
import { describeSla, liveSla } from '../lib/sla.js';

export function StatusBadge({ status }) {
  return (
    <span className={`badge status-${slug(status)}`}>
      <span className="badge-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

export function PriorityBadge({ priority }) {
  return (
    <span className={`badge priority priority-${slug(priority)}`}>
      <span className="priority-dot" aria-hidden="true" />
      {priority}
    </span>
  );
}

/**
 * First-response SLA status with a live countdown. Wording and shape (critical and
 * breached are boxed, approaching is bold) carry the urgency, so it does not depend on
 * colour; screen readers get a full sentence.
 */
export function SlaBadge({ sla }) {
  const live = liveSla(sla, useNow());
  const { label, description } = describeSla(live);
  const urgency = live?.urgency ?? 'unknown';
  return (
    <span className={`sla sla-${urgency}`} title={description}>
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{description}</span>
    </span>
  );
}

/** Overdue, escalation and SLA-breach flags. `showSla` is off where an SLA column already says it. */
export function TicketFlags({ ticket, showSla = true }) {
  // Follows the live countdown, so the flag appears as soon as the deadline passes.
  const live = liveSla(ticket.sla, useNow());
  const slaBreached = live ? live.urgency === 'breached' || live.urgency === 'responded_late' : ticket.slaBreached;
  return (
    <>
      {ticket.isOverdue && (
        <span className="badge flag-overdue" title="Not resolved and created more than 24 hours ago">
          Overdue
        </span>
      )}
      {ticket.escalation?.active && (
        <span
          className={`badge flag-escalated level-${ticket.escalation.stage}`}
          title={`Escalation level ${ticket.escalation.stage}${ticket.escalation.acknowledgedAt ? ', acknowledged' : ', not acknowledged'}`}
        >
          {ticket.escalation.stage === 2 ? 'Senior attention' : 'Escalated'}
          {ticket.escalation.acknowledgedAt && ' · ack’d'}
        </span>
      )}
      {showSla && slaBreached && ticket.status !== 'Resolved' && (
        <span className="badge flag-sla" title="No public reply within the response-time target">
          SLA breached
        </span>
      )}
    </>
  );
}
