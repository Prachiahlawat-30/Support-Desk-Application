import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { EVENT_TYPES, RESOLVED } from '../domain/constants.js';
import {
  escalationActiveSql,
  escalationColumnsSql,
  escalationJoinSql,
  overdueSql,
  priorityRankSql,
  slaBreachedSql,
  slaColumnsSql,
  slaUrgencySql,
} from '../domain/rules.js';
import { diffTicket } from '../domain/ticketChanges.js';
import { badRequest, notFound, validationError } from '../utils/httpError.js';
import { listEscalations } from './escalationService.js';
import { UPDATE_REASONS } from '../realtime/events.js';
import { publish } from '../realtime/publisher.js';
import { toEvent, toMessage, toTicket } from './mappers.js';
import { findUserById } from './userService.js';

const TICKET_SELECT = `
  SELECT t.*,
         a.name AS assignee_name,
         ${overdueSql('t')} AS is_overdue,
         ${slaColumnsSql(config.slaFirstResponseHours, 't')},
         ${escalationColumnsSql(config.slaFirstResponseHours, 't')}
  FROM tickets t
  LEFT JOIN users a ON a.id = t.assignee_id
  ${escalationJoinSql('t')}`;

const ORDER_BY = {
  updated: 't.updated_at DESC, t.id DESC',
  priority: `${priorityRankSql('t')} DESC, t.updated_at DESC, t.id DESC`,
  created: 't.created_at DESC, t.id DESC',
};

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// The ticket field a history entry is about (status, priority and assignee events carry no field name).
const EVENT_FIELDS = {
  [EVENT_TYPES.STATUS_CHANGED]: 'status',
  [EVENT_TYPES.PRIORITY_CHANGED]: 'priority',
  [EVENT_TYPES.ASSIGNEE_CHANGED]: 'assigneeId',
};
const changedField = (change) => EVENT_FIELDS[change.eventType] ?? change.field;

async function fetchTicket(db, id) {
  const { rows } = await db.query(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
  if (!rows[0]) throw notFound(`Ticket #${id} was not found`);
  return toTicket(rows[0]);
}

async function resolveAssigneeName(db, assigneeId) {
  if (assigneeId === null) return null;
  const agent = await findUserById(assigneeId, db);
  if (!agent) throw validationError({ assigneeId: 'Selected agent does not exist' });
  return agent.name;
}

async function insertEvent(db, ticketId, actorId, { eventType, field = null, oldValue = null, newValue = null }) {
  await db.query(
    `INSERT INTO ticket_events (ticket_id, actor_id, event_type, field, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ticketId, actorId, eventType, field, oldValue, newValue],
  );
}

export async function listTickets(filters) {
  const where = [];
  const params = [];
  const param = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.search) {
    const p = param(`%${escapeLike(filters.search)}%`);
    where.push(`(t.subject ILIKE ${p} OR t.customer_name ILIKE ${p} OR t.customer_email ILIKE ${p})`);
  }
  if (filters.statuses.length) where.push(`t.status = ANY(${param(filters.statuses)})`);
  if (filters.priorities.length) where.push(`t.priority = ANY(${param(filters.priorities)})`);
  if (filters.unassigned) where.push('t.assignee_id IS NULL');
  else if (filters.assigneeId) where.push(`t.assignee_id = ${param(filters.assigneeId)}`);
  if (filters.overdue) where.push(overdueSql('t'));
  if (filters.slaBreached) where.push(slaBreachedSql(config.slaFirstResponseHours, 't'));
  if (filters.slaDue) where.push(`${slaUrgencySql(config.slaFirstResponseHours, 't')} IN ('approaching', 'critical')`);
  if (filters.escalation) {
    const minStage = filters.escalation === 'level2' ? 2 : 1;
    where.push(escalationActiveSql(config.slaFirstResponseHours, minStage, 't'));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const countParams = [...params];
  const limit = param(filters.pageSize);
  const offset = param((filters.page - 1) * filters.pageSize);

  const [countResult, pageResult] = await Promise.all([
    query(`SELECT count(*)::int AS total FROM tickets t ${whereSql}`, countParams),
    query(`${TICKET_SELECT} ${whereSql} ORDER BY ${ORDER_BY[filters.sort]} LIMIT ${limit} OFFSET ${offset}`, params),
  ]);

  const total = countResult.rows[0].total;
  return {
    data: pageResult.rows.map(toTicket),
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / filters.pageSize)),
    },
  };
}

/** The ticket with its flags, without messages or history. */
export function getTicket(id) {
  return fetchTicket({ query }, id);
}

export async function getTicketDetail(id) {
  const ticket = await fetchTicket({ query }, id);
  const [messages, events] = await Promise.all([
    query(
      `SELECT m.*, u.name AS author_name
       FROM ticket_messages m JOIN users u ON u.id = m.author_id
       WHERE m.ticket_id = $1 ORDER BY m.created_at, m.id`,
      [id],
    ),
    query(
      `SELECT e.*, u.name AS actor_name
       FROM ticket_events e LEFT JOIN users u ON u.id = e.actor_id
       WHERE e.ticket_id = $1 ORDER BY e.created_at, e.id`,
      [id],
    ),
  ]);
  return {
    ...ticket,
    messages: messages.rows.map(toMessage),
    events: events.rows.map(toEvent),
    escalations: await listEscalations(id),
    escalationPolicy: { level2Hours: config.escalation.level2Hours },
  };
}

export async function createTicket(input, actor) {
  const ticket = await withTransaction(async (db) => {
    const assigneeName = await resolveAssigneeName(db, input.assigneeId);
    const { rows } = await db.query(
      `INSERT INTO tickets
         (subject, customer_name, customer_email, description, status, priority, assignee_id, created_by, resolved_at)
       VALUES ($1, $2, $3, $4, $5::text, $6, $7, $8, CASE WHEN $5::text = '${RESOLVED}' THEN now() END)
       RETURNING id`,
      [
        input.subject,
        input.customerName,
        input.customerEmail,
        input.description,
        input.status,
        input.priority,
        input.assigneeId,
        actor.id,
      ],
    );
    const id = rows[0].id;
    await insertEvent(db, id, actor.id, { eventType: EVENT_TYPES.CREATED, newValue: input.status });
    if (assigneeName) {
      await insertEvent(db, id, actor.id, { eventType: EVENT_TYPES.ASSIGNEE_CHANGED, newValue: assigneeName });
    }
    return fetchTicket(db, id);
  });
  // After commit: tell open workspaces a ticket exists.
  publish.ticketCreated(ticket, actor.id);
  return ticket;
}

export async function updateTicket(id, patch, actor) {
  let changes = [];
  const ticket = await withTransaction(async (db) => {
    // Lock the row so concurrent updates can't interleave their history entries.
    const { rows } = await db.query(
      `SELECT t.*, a.name AS assignee_name
       FROM tickets t LEFT JOIN users a ON a.id = t.assignee_id
       WHERE t.id = $1 FOR UPDATE OF t`,
      [id],
    );
    if (!rows[0]) throw notFound(`Ticket #${id} was not found`);
    const before = toTicket(rows[0]);

    const after = { ...before, ...patch };
    if (patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId) {
      after.assigneeName = await resolveAssigneeName(db, patch.assigneeId);
    }
    if (!after.customerName && !after.customerEmail) {
      throw validationError({ customer: 'Provide a customer name or email' });
    }

    changes = diffTicket(before, after);
    if (changes.length === 0) return fetchTicket(db, id); // no-op: keep updated_at and history untouched

    await db.query(
      `UPDATE tickets SET
         subject = $2, customer_name = $3, customer_email = $4, description = $5,
         status = $6::text, priority = $7, assignee_id = $8,
         resolved_at = CASE WHEN $6::text = '${RESOLVED}' THEN coalesce(resolved_at, now()) END,
         updated_at = now()
       WHERE id = $1`,
      [
        id,
        after.subject,
        after.customerName,
        after.customerEmail,
        after.description,
        after.status,
        after.priority,
        after.assigneeId,
      ],
    );
    for (const change of changes) await insertEvent(db, id, actor.id, change);
    return fetchTicket(db, id);
  });
  // After commit, and only when something changed (a no-op update sends nothing).
  if (changes.length) {
    publish.ticketUpdated({
      ticketId: id,
      ticket,
      fields: changes.map(changedField),
      reason: UPDATE_REASONS.EDITED,
      actorId: actor.id,
    });
  }
  return ticket;
}

export async function addMessage(ticketId, { kind, body }, actor) {
  const message = await withTransaction(async (db) => {
    const { rowCount } = await db.query('SELECT 1 FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (rowCount === 0) throw notFound(`Ticket #${ticketId} was not found`);

    const { rows } = await db.query(
      `INSERT INTO ticket_messages (ticket_id, kind, body, author_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [ticketId, kind, body, actor.id],
    );
    // Only a public reply counts as a response to the customer (for the SLA).
    await db.query(
      `UPDATE tickets SET
         updated_at = now(),
         first_response_at = CASE WHEN $2::text = 'reply' THEN coalesce(first_response_at, now()) ELSE first_response_at END
       WHERE id = $1`,
      [ticketId, kind],
    );
    await insertEvent(db, ticketId, actor.id, {
      eventType: kind === 'reply' ? EVENT_TYPES.REPLY_ADDED : EVENT_TYPES.NOTE_ADDED,
    });
    return toMessage({ ...rows[0], author_name: actor.name });
  });
  // After commit. Who receives a note is decided from the saved message's kind.
  void publish.messageAdded(message);
  publish.ticketUpdated({ ticketId, reason: UPDATE_REASONS.MESSAGE, actorId: actor.id });
  return message;
}

/** Deletes a ticket; its messages and history are removed by ON DELETE CASCADE. */
export async function deleteTicket(id, actor = null) {
  const { rowCount } = await query('DELETE FROM tickets WHERE id = $1', [id]);
  if (rowCount === 0) throw notFound(`Ticket #${id} was not found`);
  publish.ticketDeleted(id, actor?.id);
}

export function parseTicketId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) {
    throw badRequest('Ticket id must be a positive integer');
  }
  return id;
}
