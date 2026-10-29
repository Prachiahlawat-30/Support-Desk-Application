import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ConfirmDialog } from '../components/ui/ConfirmDialog.jsx';
import { useTicketRealtime } from '../hooks/useRealtime.js';
import { formatDateTime } from '../lib/format.js';
import { appendMessage, applyTicketChanges, debounce } from '../lib/ticketUpdates.js';
import { ArrowLeft, Pencil, SearchX, Trash2 } from 'lucide-react';

export function TicketDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletedElsewhere, setDeletedElsewhere] = useState(false);
  const deletingHere = useRef(false); // this tab started the delete, so it navigates itself

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

  // Live updates from other users: apply what the event says at once, then reload from the
  // API shortly after (history, SLA and escalation stay authoritative). Own changes arrive
  // too; applying them is harmless because messages are de-duplicated by id.
  const reloadSoon = useMemo(() => debounce(() => load(), 400), [load]);
  useEffect(() => () => reloadSoon.cancel(), [reloadSoon]);
  useEffect(() => setDeletedElsewhere(false), [id]);
  useTicketRealtime(Number(id), {
    onUpdated: (payload) => {
      setTicket((t) => applyTicketChanges(t, payload));
      reloadSoon();
    },
    onMessage: (payload) => {
      setTicket((t) => appendMessage(t, payload));
      reloadSoon();
    },
    onDeleted: () => {
      // Deleted by anyone else, including the same user in another tab.
      if (!deletingHere.current) setDeletedElsewhere(true);
    },
    onResync: () => load(),
  });

  async function handleDelete() {
    deletingHere.current = true;
    setDeleting(true);
    try {
      await api.deleteTicket(ticket.id);
      navigate('/tickets', { replace: true });
    } catch (err) {
      deletingHere.current = false;
      setError(err);
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  if (deletedElsewhere) {
    return (
      <div className="panel">
        <EmptyState
          icon={SearchX}
          title="This ticket was deleted"
          action={
            <Link to="/tickets" className="btn">
              Back to tickets
            </Link>
          }
        >
          Ticket #{id} was deleted while you had it open.
        </EmptyState>
      </div>
    );
  }
  if (error && error.status === 404) {
    return (
      <div className="panel">
        <EmptyState
          icon={SearchX}
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

  const customer = ticket.customerName || ticket.customerEmail;

  return (
    <div className="page">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/tickets">
          <ArrowLeft size={14} aria-hidden="true" /> Tickets
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">#{ticket.id}</span>
      </nav>
      <ErrorMessage error={error} />

      <section className="panel ticket-header">
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
              <div className="ticket-title-text">
                <span className="ticket-id ticket-id-lg">#{ticket.id}</span>
                <h1>{ticket.subject}</h1>
              </div>
              <div className="ticket-actions">
                <button type="button" className="btn btn-small" onClick={() => setEditing(true)}>
                  <Pencil size={14} aria-hidden="true" /> Edit details
                </button>
                {user.role === 'admin' && (
                  <button type="button" className="btn btn-small btn-danger" onClick={() => setConfirmingDelete(true)}>
                    <Trash2 size={14} aria-hidden="true" /> Delete
                  </button>
                )}
              </div>
            </div>
            <div className="badges-row">
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
              <TicketFlags ticket={ticket} />
            </div>
            <p className="ticket-meta">
              From <strong>{customer}</strong>
              {ticket.customerName && ticket.customerEmail && <span className="muted"> &lt;{ticket.customerEmail}&gt;</span>}
              <span className="dot-sep" aria-hidden="true" />
              Opened {formatDateTime(ticket.createdAt)}
              <span className="dot-sep" aria-hidden="true" />
              {ticket.assigneeName ? (
                <>
                  Assigned to <strong>{ticket.assigneeName}</strong>
                </>
              ) : (
                <span className="muted">Unassigned</span>
              )}
            </p>
          </>
        )}
      </section>

      <div className="detail-layout">
        <div className="detail-main">
          <CopilotPanel key={ticket.id} ticket={ticket} />

          <section className="card" aria-labelledby="conversation-title">
            <div className="panel-head">
              <h2 id="conversation-title">Conversation</h2>
              <span className="muted small">
                {ticket.messages.length} {ticket.messages.length === 1 ? 'message' : 'messages'}
              </span>
            </div>
            <article className="message message-customer">
              <div className="message-header">
                <span className="avatar avatar-sm avatar-customer" aria-hidden="true">
                  {customer.slice(0, 1).toUpperCase()}
                </span>
                <strong>{customer}</strong>
                <span className="message-kind">Original request</span>
                <time dateTime={ticket.createdAt} title={formatDateTime(ticket.createdAt)} className="muted">
                  {formatDateTime(ticket.createdAt)}
                </time>
              </div>
              <p className="message-body">{ticket.description}</p>
            </article>
            <Conversation messages={ticket.messages} />
            <MessageComposer ticketId={ticket.id} onAdded={load} />
          </section>
        </div>

        <aside className="detail-side">
          <section className="card" aria-labelledby="properties-title">
            <h2 id="properties-title">Properties</h2>
            <TicketProperties ticket={ticket} onUpdated={load} />
            <dl className="meta">
              <dt>Customer</dt>
              <dd>
                {ticket.customerName && <div>{ticket.customerName}</div>}
                {ticket.customerEmail && <div className="muted">{ticket.customerEmail}</div>}
              </dd>
              <dt>Created</dt>
              <dd>{formatDateTime(ticket.createdAt)}</dd>
              <dt>Updated</dt>
              <dd>{formatDateTime(ticket.updatedAt)}</dd>
              <dt>First reply</dt>
              <dd>{ticket.firstResponseAt ? formatDateTime(ticket.firstResponseAt) : <span className="muted">Not sent yet</span>}</dd>
              {ticket.resolvedAt && (
                <>
                  <dt>Resolved</dt>
                  <dd>{formatDateTime(ticket.resolvedAt)}</dd>
                </>
              )}
            </dl>
          </section>

          <SlaPanel ticket={ticket} />
          <EscalationPanel ticket={ticket} onUpdated={load} />

          <section className="card" aria-labelledby="activity-title">
            <h2 id="activity-title">Activity</h2>
            <ActivityLog events={ticket.events} />
          </section>
        </aside>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ticket #${ticket.id}?`}
        confirmLabel="Delete ticket"
        danger
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      >
        Its replies, internal notes and history will be deleted too. This cannot be undone.
      </ConfirmDialog>
    </div>
  );
}
