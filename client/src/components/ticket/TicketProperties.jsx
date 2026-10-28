import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAgents } from '../../hooks/useAgents.js';
import { PRIORITIES, STATUSES } from '../../lib/constants.js';
import { Spinner } from '../Feedback.jsx';

/** Status / priority / assignee selects. Each change is saved immediately. */
export function TicketProperties({ ticket, onUpdated }) {
  const { agents } = useAgents();
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);

  async function save(field, value) {
    setSaving(field);
    setError(null);
    try {
      await api.updateTicket(ticket.id, { [field]: value });
      await onUpdated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(null);
    }
  }

  const disabled = saving !== null;

  return (
    <div className="properties">
      <label className="property">
        <span>Status {saving === 'status' && <Spinner small />}</span>
        <select value={ticket.status} disabled={disabled} onChange={(e) => save('status', e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <label className="property">
        <span>Priority {saving === 'priority' && <Spinner small />}</span>
        <select value={ticket.priority} disabled={disabled} onChange={(e) => save('priority', e.target.value)}>
          {PRIORITIES.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <label className="property">
        <span>Assignee {saving === 'assigneeId' && <Spinner small />}</span>
        <select
          value={ticket.assigneeId ?? ''}
          disabled={disabled}
          onChange={(e) => save('assigneeId', e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}
