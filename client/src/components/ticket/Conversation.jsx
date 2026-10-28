import { formatDateTime, timeAgo } from '../../lib/format.js';

const KIND = {
  reply: { label: 'Reply', hint: 'Visible to the customer' },
  note: { label: 'Internal note', hint: 'Only visible to the support team' },
};

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
              <strong>{m.authorName}</strong>
              <span className="message-kind">{kind.label}</span>
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
