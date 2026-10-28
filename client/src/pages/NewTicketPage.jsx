import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { Spinner } from '../components/Feedback.jsx';
import { Field } from '../components/Field.jsx';
import { useAgents } from '../hooks/useAgents.js';
import { LIMITS, PRIORITIES, STATUSES } from '../lib/constants.js';
import { validateTicketForm } from '../lib/validation.js';

const EMPTY = {
  subject: '',
  customerName: '',
  customerEmail: '',
  description: '',
  priority: 'Medium',
  status: 'Open',
  assigneeId: '',
};

export function NewTicketPage() {
  const navigate = useNavigate();
  const { agents, error: agentsError } = useAgents();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);

  function change(field) {
    return (e) => {
      const next = { ...values, [field]: e.target.value };
      setValues(next);
      // After the first submit attempt, re-validate as the user fixes things.
      if (submitted) setErrors(validateTicketForm(next));
    };
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    const found = validateTicketForm(values);
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    try {
      const { data } = await api.createTicket({
        ...values,
        customerName: values.customerName.trim() || null,
        customerEmail: values.customerEmail.trim() || null,
        assigneeId: values.assigneeId ? Number(values.assigneeId) : null,
      });
      navigate(`/tickets/${data.id}`);
    } catch (err) {
      setServerError(err);
      if (err.details) setErrors(err.details);
      setSaving(false);
    }
  }

  const customerError = errors.customer;

  return (
    <div className="page page-narrow">
      <div className="page-header">
        <h1>New ticket</h1>
        <Link to="/tickets" className="btn btn-link">
          Cancel
        </Link>
      </div>

      <form className="card form" onSubmit={handleSubmit} noValidate>
        {serverError && (
          <div className="alert alert-error" role="alert">
            {serverError.message}
          </div>
        )}

        <Field label="Subject" htmlFor="subject" error={errors.subject} required>
          <input id="subject" maxLength={LIMITS.subject} value={values.subject} onChange={change('subject')} autoFocus />
        </Field>

        <div className={`field-group${customerError ? ' field-group-invalid' : ''}`}>
          <div className="form-row">
            <Field label="Customer name" htmlFor="customerName" error={errors.customerName}>
              <input id="customerName" maxLength={LIMITS.customerName} value={values.customerName} onChange={change('customerName')} />
            </Field>
            <Field label="Customer email" htmlFor="customerEmail" error={errors.customerEmail}>
              <input id="customerEmail" type="email" value={values.customerEmail} onChange={change('customerEmail')} />
            </Field>
          </div>
          <p className={customerError ? 'field-error' : 'field-hint'}>
            {customerError || 'A customer name or email is required (both is best).'}
          </p>
        </div>

        <Field label="Description" htmlFor="description" error={errors.description} required>
          <textarea id="description" rows={6} value={values.description} onChange={change('description')} />
        </Field>

        <div className="form-row form-row-3">
          <Field label="Priority" htmlFor="priority" error={errors.priority}>
            <select id="priority" value={values.priority} onChange={change('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="status" error={errors.status}>
            <select id="status" value={values.status} onChange={change('status')}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field
            label="Assignee"
            htmlFor="assigneeId"
            error={errors.assigneeId}
            hint={agentsError ? 'Could not load agents' : undefined}
          >
            <select id="assigneeId" value={values.assigneeId} onChange={change('assigneeId')}>
              <option value="">Unassigned</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving && <Spinner small />} {saving ? 'Creating…' : 'Create ticket'}
          </button>
        </div>
      </form>
    </div>
  );
}
