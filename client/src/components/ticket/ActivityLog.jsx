import {
  CheckCheck,
  CircleDot,
  Flag,
  Lock,
  MessageSquare,
  Pencil,
  Plus,
  Siren,
  UserRound,
} from 'lucide-react';
import { formatDateTime, timeAgo } from '../../lib/format.js';

const EVENT_ICONS = {
  created: Plus,
  status_changed: CircleDot,
  priority_changed: Flag,
  assignee_changed: UserRound,
  field_updated: Pencil,
  reply_added: MessageSquare,
  note_added: Lock,
  escalated: Siren,
  escalation_acknowledged: CheckCheck,
};

const FIELD_LABELS = {
  subject: 'subject',
  customerName: 'customer name',
  customerEmail: 'customer email',
  description: 'description',
};

const show = (value) => <strong>{value ?? 'none'}</strong>;

function describe(event) {
  const { eventType, field, oldValue, newValue } = event;
  switch (eventType) {
    case 'created':
      return <>created the ticket</>;
    case 'status_changed':
      return <>changed status from {show(oldValue)} to {show(newValue)}</>;
    case 'priority_changed':
      return <>changed priority from {show(oldValue)} to {show(newValue)}</>;
    case 'assignee_changed':
      if (!oldValue) return <>assigned the ticket to {show(newValue)}</>;
      if (!newValue) return <>unassigned {show(oldValue)}</>;
      return <>reassigned from {show(oldValue)} to {show(newValue)}</>;
    case 'field_updated':
      if (field === 'description') return <>edited the description</>;
      return <>changed the {FIELD_LABELS[field] ?? field} from {show(oldValue)} to {show(newValue)}</>;
    case 'reply_added':
      return <>sent a public reply</>;
    case 'note_added':
      return <>added an internal note</>;
    case 'escalated':
      return <>escalated the ticket to {show(newValue)}</>;
    case 'escalation_acknowledged':
      return <>acknowledged the escalation ({newValue})</>;
    default:
      return <>{eventType.replace(/_/g, ' ')}</>;
  }
}

/** Ticket history, oldest first. */
export function ActivityLog({ events }) {
  if (events.length === 0) return <p className="muted">No activity recorded.</p>;
  return (
    <ol className="activity">
      {events.map((e) => {
        const Icon = EVENT_ICONS[e.eventType] ?? CircleDot;
        return (
          <li key={e.id} className={`activity-item activity-${e.eventType}`}>
            <span className="activity-icon" aria-hidden="true">
              <Icon size={12} strokeWidth={2.2} />
            </span>
            <div className="activity-text">
              <div>
                <span className="activity-actor">{e.actorName ?? 'System'}</span> {describe(e)}
              </div>
              <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)} className="muted small">
                {timeAgo(e.createdAt)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
