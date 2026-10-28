import { useNow } from '../../hooks/useNow.js';
import { formatDateTime } from '../../lib/format.js';
import { formatMinutes, liveSla } from '../../lib/sla.js';
import { SlaBadge } from '../Badges.jsx';

function outcome(sla, ticket) {
  switch (sla.urgency) {
    case 'responded_on_time':
      return 'Met: the first public reply was sent before the deadline.';
    case 'responded_late': {
      const lateBy = Math.floor((new Date(ticket.firstResponseAt) - new Date(sla.deadline)) / 60_000);
      return `Missed: the first public reply was sent ${formatMinutes(lateBy)} after the deadline.`;
    }
    case 'breached':
      return 'Missed: the deadline passed without a public reply. Reply as soon as possible.';
    case 'not_applicable':
      return 'Not applicable: the ticket was resolved before any public reply was sent.';
    default:
      return 'Pending: waiting for the first public reply.';
  }
}

/** First-response SLA details for one ticket. All values come from the server's SLA calculation. */
export function SlaPanel({ ticket }) {
  const sla = liveSla(ticket.sla, useNow());

  return (
    <section className="card" aria-labelledby="sla-title">
      <h2 id="sla-title">First-response SLA</h2>
      {!sla ? (
        <p className="muted small">SLA information is not available for this ticket.</p>
      ) : (
        <>
          <div className="sla-panel-status">
            <SlaBadge sla={ticket.sla} />
          </div>
          <dl className="meta">
            <dt>Target</dt>
            <dd>
              First public reply within {sla.targetHours} {sla.targetHours === 1 ? 'hour' : 'hours'}
            </dd>
            <dt>Deadline</dt>
            <dd>{formatDateTime(sla.deadline)}</dd>
            <dt>First reply</dt>
            <dd>
              {ticket.firstResponseAt ? formatDateTime(ticket.firstResponseAt) : <span className="muted">Not sent yet</span>}
            </dd>
            <dt>Result</dt>
            <dd>{outcome(sla, ticket)}</dd>
          </dl>
          <p className="muted small sla-note">Internal notes don't count as a response. Only a public reply does.</p>
        </>
      )}
    </section>
  );
}
