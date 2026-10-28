import { useState } from 'react';
import { api } from '../../api/client.js';
import { LIMITS } from '../../lib/constants.js';
import { validateTicketForm } from '../../lib/validation.js';
import { Spinner } from '../Feedback.jsx';
import { Field } from '../Field.jsx';

/** Inline editor for subject, customer and description. */
export function TicketDetailsForm({ ticket, onSaved, onCancel }) {
  const [values, setValues] = useState({
    subject: ticket.subject,
    customerName: ticket.customerName ?? '',
    customerEmail: ticket.customerEmail ?? '',
    description: ticket.description,
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);

  const change = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    const found = validateTicketForm(values);
    setErrors(found);
    if (Object.keys(found).length) return;

    setSaving(true);
    setServerError(null);
    try {
      await api.updateTicket(ticket.id, {
        subject: values.subject,
        description: values.description,
        customerName: values.customerName.trim() || null,
        customerEmail: values.customerEmail.trim() || null,
      });
      await onSaved();
    } catch (err) {
      setServerError(err.message);
      if (err.details) setErrors(err.details);
      setSaving(false);
    }
  }

  return (
    <form className="form details-form" onSubmit={handleSubmit} noValidate>
      {serverError && <div className="alert alert-error">{serverError}</div>}
      <Field label="Subject" htmlFor="edit-subject" error={errors.subject} required>
        <input id="edit-subject" maxLength={LIMITS.subject} value={values.subject} onChange={change('subject')} />
      </Field>
      <div className="form-row">
        <Field label="Customer name" htmlFor="edit-name" error={errors.customerName}>
          <input id="edit-name" value={values.customerName} onChange={change('customerName')} />
        </Field>
        <Field label="Customer email" htmlFor="edit-email" error={errors.customerEmail}>
          <input id="edit-email" type="email" value={values.customerEmail} onChange={change('customerEmail')} />
        </Field>
      </div>
      {errors.customer && <p className="field-error">{errors.customer}</p>}
      <Field label="Description" htmlFor="edit-description" error={errors.description} required>
        <textarea id="edit-description" rows={6} value={values.description} onChange={change('description')} />
      </Field>
      <div className="form-actions">
        <button type="button" className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving && <Spinner small />} Save changes
        </button>
      </div>
    </form>
  );
}
