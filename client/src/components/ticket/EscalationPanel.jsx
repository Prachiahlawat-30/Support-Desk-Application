import { useState } from 'react';
import { api } from '../../api/client.js';
import { formatDateTime } from '../../lib/format.js';
import { ESCALATION_LABELS, escalationReason } from '../../lib/escalation.js';
import { ErrorMessage, Spinner } from '../Feedback.jsx';

/**
 * SLA escalation state for one ticket. Escalations are recorded by the server's
 * escalation check; this panel only displays them and lets an agent acknowledge them.
 */
export function EscalationPanel({ ticket, onUpdated }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const records = ticket.escalations ?? [];
  const current = ticket.escalation;
  const level2Hours = ticket.escalationPolicy?.level2Hours;
  const unacknowledged = records.some((r) => !r.acknowledgedAt);

  async function acknowledge() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await api.acknowledgeEscalation(ticket.id);
      await onUpdated();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  let status;
  if (!current) status = 'Not escalated';
  else if (current.active) status = `Active · Level ${current.stage}: ${ESCALATION_LABELS[current.stage] ?? 'Escalated'}`;
  else status = `Ended · reached Level ${current.stage}`;

  return (
    <section className="card" aria-labelledby="escalation-title">
      <h2 id="escalation-title">Escalation</h2>
      <p className={`escalation-status${current?.active ? ` escalation-active level-${current.stage}` : ''}`}>
        {status}
      </p>

      {records.length === 0 ? (
        <p className="muted small">
          Escalated when the first-response SLA is breached
          {level2Hours ? `, and to senior attention ${level2Hours}h after the deadline` : ''} if there is still no public
          reply.
        </p>
      ) : (
        <ol className="escalation-list">
          {records.map((r) => (
            <li key={r.stage}>
              <div>
                <strong>
                  Level {r.stage}: {r.label}
                </strong>{' '}
                <span className="muted small">{formatDateTime(r.escalatedAt)}</span>
              </div>
              <div className="small">{escalationReason(r.rule, level2Hours)}</div>
              <div className="small muted">
                {r.acknowledgedAt
                  ? `Acknowledged by ${r.acknowledgedByName ?? 'a removed user'} · ${formatDateTime(r.acknowledgedAt)}`
                  : 'Not acknowledged'}
              </div>
            </li>
          ))}
        </ol>
      )}

      {current && !current.active && (
        <p className="muted small">Ended because the ticket has a public reply or is resolved.</p>
      )}

      {unacknowledged && (
        <button type="button" className="btn btn-block" onClick={acknowledge} disabled={saving}>
          {saving && <Spinner small />} Acknowledge escalation
        </button>
      )}
      <ErrorMessage error={error} />
    </section>
  );
}
