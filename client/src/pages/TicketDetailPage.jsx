import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PriorityBadge, StatusBadge, TicketFlags } from '../components/Badges.jsx';
import { EmptyState, ErrorMessage, Loading } from '../components/Feedback.jsx';
import { ActivityLog } from '../components/ticket/ActivityLog.jsx';
import { Conversation } from '../components/ticket/Conversation.jsx';
import { CopilotPanel } from '../components/ticket/CopilotPanel.jsx';
import { MessageComposer } from '../components/ticket/MessageComposer.jsx';
import { EscalationPanel } from '../components/ticket/EscalationPanel.jsx';
import { SlaPanel } from '../components/ticket/SlaPanel.jsx';
import { TicketDetailsForm } from '../components/ticket/TicketDetailsForm.jsx';
import { TicketProperties } from '../components/ticket/TicketProperties.jsx';
import { formatDateTime } from '../lib/format.js';

export function TicketDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Re-fetches the whole ticket so history, flags and timestamps stay consistent with the server.
  const load = useCallback(async () => {
    try {
      const { data } = await api.getTicket(id);
      setTicket(data);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    setTicket(null);
    setEditing(false);
    load();
  }, [load]);

  async function handleDelete() {
    if (!window.confirm(`Delete ticket #${ticket.id}? Its replies, notes and history will be deleted too.`)) return;
    setDeleting(true);
    try {
      await api.deleteTicket(ticket.id);
      navigate('/tickets', { replace: true });
    } catch (err) {
      setError(err);
      setDeleting(false);
    }
  }

  if (error && error.status === 404) {
    return (
      <div className="card">
        <EmptyState
          title="Ticket not found"
          action={
            <Link to="/tickets" className="btn">
              Back to tickets
            </Link>
          }
        >
          Ticket #{id} does not exist or has been deleted.
        </EmptyState>
      </div>
    );
  }
  if (!ticket) return error ? <ErrorMessage error={error} onRetry={load} /> : <Loading label="Loading ticket…" />;

  return (
    <div className="page">
      <Link to="/tickets" className="back-link">
        ← All tickets
      </Link>
      <ErrorMessage error={error} />

      <div className="detail-layout">
        <div className="detail-main">
          <section className="card">
            {editing ? (
              <TicketDetailsForm
                ticket={ticket}
                onCancel={() => setEditing(false)}
                onSaved={async () => {
                  await load();
                  setEditing(false);
                }}
              />
            ) : (
              <>
                <div className="ticket-title">
                  <h1>
                    <span className="muted">#{ticket.id}</span> {ticket.subject}
                  </h1>
                  <button type="button" className="btn btn-small" onClick={() => setEditing(true)}>
                    Edit details
                  </button>
                </div>
                <div className="badges-row">
                  <StatusBadge status={ticket.status} />
                  <PriorityBadge priority={ticket.priority} />
                  <TicketFlags ticket={ticket} />
                </div>
                <div className="original-request">
                  <div className="muted small">
                    Original request from <strong>{ticket.customerName || ticket.customerEmail}</strong>
                    {ticket.customerName && ticket.customerEmail && <> &lt;{ticket.customerEmail}&gt;</>} ·{' '}
                    {formatDateTime(ticket.createdAt)}
                  </div>
                  <p className="description">{ticket.description}</p>
                </div>
              </>
            )}
          </section>

          <CopilotPanel key={ticket.id} ticket={ticket} />

          <section className="card">
            <h2>Conversation</h2>
            <Conversation messages={ticket.messages} />
            <MessageComposer ticketId={ticket.id} onAdded={load} />
          </section>
        </div>

        <aside className="detail-side">
          <section className="card">
            <h2>Properties</h2>
            <TicketProperties ticket={ticket} onUpdated={load} />
            <dl className="meta">
              <dt>Customer</dt>
              <dd>
                {ticket.customerName && <div>{ticket.customerName}</div>}
                {ticket.customerEmail && <div className="muted">{ticket.customerEmail}</div>}
              </dd>
              <dt>Created</dt>
              <dd>{formatDateTime(ticket.createdAt)}</dd>
              <dt>Last updated</dt>
              <dd>{formatDateTime(ticket.updatedAt)}</dd>
              <dt>First response</dt>
              <dd>{ticket.firstResponseAt ? formatDateTime(ticket.firstResponseAt) : <span className="muted">No reply yet</span>}</dd>
              {ticket.resolvedAt && (
                <>
                  <dt>Resolved</dt>
                  <dd>{formatDateTime(ticket.resolvedAt)}</dd>
                </>
              )}
            </dl>
            {user.role === 'admin' && (
              <button type="button" className="btn btn-danger btn-block" onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : 'Delete ticket'}
              </button>
            )}
          </section>

          <SlaPanel ticket={ticket} />
          <EscalationPanel ticket={ticket} onUpdated={load} />

          <section className="card">
            <h2>Activity</h2>
            <ActivityLog events={ticket.events} />
          </section>
        </aside>
      </div>
    </div>
  );
}
