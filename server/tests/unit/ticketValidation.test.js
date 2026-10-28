import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateCreateTicket, validateMessage, validateTicketPatch } from '../../src/validation/ticketValidation.js';

const validTicket = {
  subject: 'Printer on fire',
  customerName: 'Jane',
  description: 'Smoke everywhere',
  priority: 'Urgent',
};

describe('validateCreateTicket', () => {
  it('accepts a valid ticket, trims text and applies defaults', () => {
    const { value, errors } = validateCreateTicket({ ...validTicket, subject: '  Printer on fire  ', priority: undefined });
    assert.equal(errors, null);
    assert.equal(value.subject, 'Printer on fire');
    assert.equal(value.status, 'Open');
    assert.equal(value.priority, 'Medium');
    assert.equal(value.assigneeId, null);
    assert.equal(value.customerEmail, null);
  });

  it('requires subject and description', () => {
    const { errors } = validateCreateTicket({ customerName: 'Jane', subject: '   ' });
    assert.equal(errors.subject, 'Subject is required');
    assert.equal(errors.description, 'Description is required');
  });

  it('requires a customer name or email', () => {
    const { errors } = validateCreateTicket({ ...validTicket, customerName: '' });
    assert.match(errors.customer, /customer name or email/);
  });

  it('accepts email only as the customer identifier and normalises it', () => {
    const { value, errors } = validateCreateTicket({ ...validTicket, customerName: undefined, customerEmail: 'Jane@Example.COM' });
    assert.equal(errors, null);
    assert.equal(value.customerEmail, 'jane@example.com');
  });

  it('rejects malformed email, unknown status/priority and bad assignee', () => {
    const { errors } = validateCreateTicket({
      ...validTicket,
      customerEmail: 'not-an-email',
      status: 'Closed',
      priority: 'Critical',
      assigneeId: 'abc',
    });
    assert.ok(errors.customerEmail);
    assert.ok(errors.status);
    assert.ok(errors.priority);
    assert.ok(errors.assigneeId);
  });

  it('rejects over-long fields and non-object bodies', () => {
    assert.ok(validateCreateTicket({ ...validTicket, subject: 'x'.repeat(201) }).errors.subject);
    assert.ok(validateCreateTicket(null).errors.body);
    assert.ok(validateCreateTicket([]).errors.body);
  });
});

describe('validateTicketPatch', () => {
  it('returns only the provided fields', () => {
    const { value, errors } = validateTicketPatch({ status: 'Resolved', ignored: true });
    assert.equal(errors, null);
    assert.deepEqual(value, { status: 'Resolved' });
  });

  it('allows unassigning with null', () => {
    assert.deepEqual(validateTicketPatch({ assigneeId: null }).value, { assigneeId: null });
  });

  it('rejects an empty patch and clearing required fields', () => {
    assert.ok(validateTicketPatch({}).errors.body);
    assert.ok(validateTicketPatch({ subject: '' }).errors.subject);
    assert.ok(validateTicketPatch({ description: '  ' }).errors.description);
  });
});

describe('validateMessage', () => {
  it('accepts replies and notes', () => {
    assert.equal(validateMessage({ kind: 'reply', body: 'Hi' }).errors, null);
    assert.equal(validateMessage({ kind: 'note', body: 'FYI' }).errors, null);
  });

  it('rejects unknown kinds and empty bodies', () => {
    const { errors } = validateMessage({ kind: 'email', body: ' ' });
    assert.ok(errors.kind);
    assert.ok(errors.body);
  });
});
