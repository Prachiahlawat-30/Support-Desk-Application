import { LIMITS, MESSAGE_KINDS, PRIORITIES, STATUSES } from '../domain/constants.js';

// Validators are pure: they return `{ value, errors }`, where `errors` is null or a
// map of field -> message that the client can show next to each input.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(errors, input, field, label, { required = false, max }) {
  const raw = input[field];
  if (raw === undefined || raw === null) {
    if (required) errors[field] = `${label} is required`;
    return null;
  }
  if (typeof raw !== 'string') {
    errors[field] = `${label} must be text`;
    return null;
  }
  const value = raw.trim();
  if (!value) {
    if (required) errors[field] = `${label} is required`;
    return null;
  }
  if (value.length > max) errors[field] = `${label} must be at most ${max} characters`;
  return value;
}

function oneOf(errors, input, field, label, allowed) {
  const value = input[field];
  if (!allowed.includes(value)) errors[field] = `${label} must be one of: ${allowed.join(', ')}`;
  return value;
}

function assigneeId(errors, input) {
  const value = input.assigneeId;
  if (value === null || value === '') return null;
  if (!Number.isInteger(value) || value <= 0) {
    errors.assigneeId = 'Assignee must be a valid agent id or null';
    return null;
  }
  return value;
}

function email(errors, input) {
  const value = text(errors, input, 'customerEmail', 'Customer email', { max: LIMITS.customerEmail });
  if (value && !errors.customerEmail && !EMAIL_RE.test(value)) errors.customerEmail = 'Customer email is not valid';
  return value ? value.toLowerCase() : value;
}

const result = (value, errors) => ({ value, errors: Object.keys(errors).length ? errors : null });

function isObject(input) {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

export function validateCreateTicket(input) {
  if (!isObject(input)) return result(null, { body: 'Request body must be a JSON object' });
  const errors = {};
  const value = {
    subject: text(errors, input, 'subject', 'Subject', { required: true, max: LIMITS.subject }),
    customerName: text(errors, input, 'customerName', 'Customer name', { max: LIMITS.customerName }),
    customerEmail: email(errors, input),
    description: text(errors, input, 'description', 'Description', { required: true, max: LIMITS.description }),
    status: input.status === undefined ? 'Open' : oneOf(errors, input, 'status', 'Status', STATUSES),
    priority: input.priority === undefined ? 'Medium' : oneOf(errors, input, 'priority', 'Priority', PRIORITIES),
    assigneeId: input.assigneeId === undefined ? null : assigneeId(errors, input),
  };
  if (!value.customerName && !value.customerEmail && !errors.customerName && !errors.customerEmail) {
    errors.customer = 'Provide a customer name or email';
  }
  return result(value, errors);
}

const PATCHABLE = ['subject', 'customerName', 'customerEmail', 'description', 'status', 'priority', 'assigneeId'];

/**
 * Validates a partial update. Only fields present in the input are returned.
 * The "name or email required" rule depends on the stored ticket, so the service
 * checks it after merging the patch.
 */
export function validateTicketPatch(input) {
  if (!isObject(input)) return result(null, { body: 'Request body must be a JSON object' });
  const present = PATCHABLE.filter((f) => input[f] !== undefined);
  if (present.length === 0) {
    return result(null, { body: `Provide at least one of: ${PATCHABLE.join(', ')}` });
  }
  const errors = {};
  const value = {};
  for (const field of present) {
    switch (field) {
      case 'subject':
        value.subject = text(errors, input, field, 'Subject', { required: true, max: LIMITS.subject });
        break;
      case 'description':
        value.description = text(errors, input, field, 'Description', { required: true, max: LIMITS.description });
        break;
      case 'customerName':
        value.customerName = text(errors, input, field, 'Customer name', { max: LIMITS.customerName });
        break;
      case 'customerEmail':
        value.customerEmail = email(errors, input);
        break;
      case 'status':
        value.status = oneOf(errors, input, field, 'Status', STATUSES);
        break;
      case 'priority':
        value.priority = oneOf(errors, input, field, 'Priority', PRIORITIES);
        break;
      case 'assigneeId':
        value.assigneeId = assigneeId(errors, input);
        break;
    }
  }
  return result(value, errors);
}

export function validateMessage(input) {
  if (!isObject(input)) return result(null, { body: 'Request body must be a JSON object' });
  const errors = {};
  const value = {
    kind: oneOf(errors, input, 'kind', 'Kind', MESSAGE_KINDS),
    body: text(errors, input, 'body', 'Message', { required: true, max: LIMITS.messageBody }),
  };
  return result(value, errors);
}
