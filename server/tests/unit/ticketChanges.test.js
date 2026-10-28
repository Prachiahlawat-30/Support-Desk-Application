import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { diffTicket } from '../../src/domain/ticketChanges.js';

const base = {
  subject: 'Login broken',
  customerName: 'Jane',
  customerEmail: null,
  description: 'Cannot log in',
  status: 'Open',
  priority: 'Medium',
  assigneeId: null,
  assigneeName: null,
};

describe('diffTicket', () => {
  it('returns no changes for an identical ticket', () => {
    assert.deepEqual(diffTicket(base, { ...base }), []);
  });

  it('records status, priority and assignee changes with display values', () => {
    const changes = diffTicket(base, {
      ...base,
      status: 'In Progress',
      priority: 'Urgent',
      assigneeId: 7,
      assigneeName: 'Priya Agent',
    });
    assert.deepEqual(changes, [
      { eventType: 'status_changed', field: null, oldValue: 'Open', newValue: 'In Progress' },
      { eventType: 'priority_changed', field: null, oldValue: 'Medium', newValue: 'Urgent' },
      { eventType: 'assignee_changed', field: null, oldValue: null, newValue: 'Priya Agent' },
    ]);
  });

  it('records detail edits per field without storing the description text', () => {
    const changes = diffTicket(base, { ...base, subject: 'Login still broken', description: 'Long text...' });
    assert.deepEqual(changes, [
      { eventType: 'field_updated', field: 'subject', oldValue: 'Login broken', newValue: 'Login still broken' },
      { eventType: 'field_updated', field: 'description', oldValue: null, newValue: null },
    ]);
  });

  it('treats undefined and null as the same value', () => {
    assert.deepEqual(diffTicket(base, { ...base, customerEmail: undefined }), []);
  });
});
