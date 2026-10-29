import { Lock, MessageSquare } from 'lucide-react';
import { formatDateTime, timeAgo } from '../../lib/format.js';

const KIND = {
  reply: { label: 'Public reply', icon: MessageSquare, hint: 'Visible to the customer' },
  note: { label: 'Internal note', icon: Lock, hint: 'Only visible to the support team' },
};

const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');

/** Replies and internal notes, oldest first. */
export function Conversation({ messages }) {
  if (messages.length === 0) {
    return <p className="muted empty-inline">No replies or notes yet. Use the box below to respond.</p>;
  }
  return (
    <ol className="conversation">
      {messages.map((m) => {
        const kind = KIND[m.kind];
        return (
          <li key={m.id} className={`message message-${m.kind}`}>
            <div className="message-header">
              <span className="avatar avatar-sm" aria-hidden="true">
                {initials(m.authorName)}
              </span>
              <strong>{m.authorName}</strong>
              <span className="message-kind">
                <kind.icon size={12} aria-hidden="true" /> {kind.label}
              </span>
              <time dateTime={m.createdAt} title={formatDateTime(m.createdAt)} className="muted">
                {timeAgo(m.createdAt)}
              </time>
            </div>
            <div className="message-body">{m.body}</div>
            {m.kind === 'note' && <div className="message-hint">{kind.hint}</div>}
          </li>
        );
      })}
    </ol>
  );
}
