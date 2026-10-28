import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseTicketListQuery } from '../../src/validation/listQuery.js';

const me = { id: 42 };

describe('parseTicketListQuery', () => {
  it('applies defaults', () => {
    const { value, errors } = parseTicketListQuery({}, me);
    assert.equal(errors, null);
    assert.deepEqual(value, {
      search: '',
      statuses: [],
      priorities: [],
      assigneeId: null,
      unassigned: false,
      overdue: false,
      slaBreached: false,
      slaDue: false,
      escalation: null,
      sort: 'updated',
      page: 1,
      pageSize: 20,
    });
  });

  it('combines multiple filters, including comma lists and repeated params', () => {
    const { value, errors } = parseTicketListQuery(
      { search: ' invoice ', status: 'Open,In Progress', priority: ['High', 'Urgent'], assignee: 'me', sort: 'priority' },
      me,
    );
    assert.equal(errors, null);
    assert.equal(value.search, 'invoice');
    assert.deepEqual(value.statuses, ['Open', 'In Progress']);
    assert.deepEqual(value.priorities, ['High', 'Urgent']);
    assert.equal(value.assigneeId, 42);
    assert.equal(value.sort, 'priority');
  });

  it('supports unassigned and numeric assignees', () => {
    assert.equal(parseTicketListQuery({ assignee: 'unassigned' }, me).value.unassigned, true);
    assert.equal(parseTicketListQuery({ assignee: '3' }, me).value.assigneeId, 3);
  });

  it('parses the overdue and SLA-breached flags', () => {
    const { value } = parseTicketListQuery({ overdue: 'true', slaBreached: '1' }, me);
    assert.equal(value.overdue, true);
    assert.equal(value.slaBreached, true);
    assert.equal(parseTicketListQuery({ slaBreached: 'false' }, me).value.slaBreached, false);
  });

  it('parses the escalation filter', () => {
    assert.equal(parseTicketListQuery({ escalation: 'active' }, me).value.escalation, 'active');
    assert.equal(parseTicketListQuery({ escalation: 'level2' }, me).value.escalation, 'level2');
    assert.ok(parseTicketListQuery({ escalation: 'all' }, me).errors.escalation);
  });

  it('rejects invalid values', () => {
    const { errors } = parseTicketListQuery(
      { status: 'Closed', priority: 'Critical', assignee: 'bob', sort: 'random', page: '0', pageSize: '1000' },
      me,
    );
    assert.deepEqual(Object.keys(errors).sort(), ['assignee', 'page', 'pageSize', 'priority', 'sort', 'status']);
  });
});
