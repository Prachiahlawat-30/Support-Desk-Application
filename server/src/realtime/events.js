// Real-time event contract. Every event name, room name and payload shape lives here.
// Payloads are built field by field from saved data: no password hashes, tokens, customer
// email addresses or raw rows are ever sent. client/src/lib/realtimeEvents.js mirrors the
// names; a test checks that both stay in sync.
//
// Client -> server (acknowledged with { ok: true } or { ok: false, error: { code, message } }):
//   ticket:subscribe    { ticketId }  join the ticket's room after the server authorises it
//   ticket:unsubscribe  { ticketId }  leave it
//
// Server -> client:
//   ticket:created        workspace room   { ticketId, createdAt, actorId, at }
//   ticket:updated        ticket + workspace rooms
//                         { ticketId, reason, fields, changes, updatedAt, actorId, at }
//   ticket:message_added  ticket room; internal notes only to sockets allowed to read notes
//                         { ticketId, message: { id, kind, body, authorId, authorName, createdAt } }
//   ticket:deleted        ticket + workspace rooms   { ticketId, actorId, at }

export const CLIENT_EVENTS = {
  SUBSCRIBE: 'ticket:subscribe',
  UNSUBSCRIBE: 'ticket:unsubscribe',
};

export const SERVER_EVENTS = {
  TICKET_CREATED: 'ticket:created',
  TICKET_UPDATED: 'ticket:updated',
  MESSAGE_ADDED: 'ticket:message_added',
  TICKET_DELETED: 'ticket:deleted',
};

/** Why a ticket:updated event was sent. */
export const UPDATE_REASONS = {
  EDITED: 'edited', // fields changed through PATCH /api/tickets/:id
  MESSAGE: 'message', // a reply or note was added (updated_at and possibly the SLA changed)
  ESCALATION: 'escalation', // the escalation check recorded a new stage
  ESCALATION_ACKNOWLEDGED: 'escalation_acknowledged',
};

/** Every signed-in support user is in this room (all of them may read every ticket). */
export const WORKSPACE_ROOM = 'workspace';
export const ticketRoom = (ticketId) => `ticket:${ticketId}`;

// Ticket fields whose new values are included in ticket:updated. Other changed fields
// (customer details, description) are only named in `fields`; clients refetch them.
const CHANGE_VALUES = {
  status: (t) => t.status,
  priority: (t) => t.priority,
  assigneeId: (t) => t.assigneeId,
  subject: (t) => t.subject,
};

/** Accepts a positive integer ticket id, as a number or a digit string. */
export function parseTicketIdPayload(payload) {
  const raw = payload && typeof payload === 'object' ? payload.ticketId : undefined;
  const id = typeof raw === 'string' && /^\d{1,10}$/.test(raw) ? Number(raw) : raw;
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null;
}

const now = () => new Date().toISOString();

export function ticketCreatedPayload(ticket, actorId) {
  return { ticketId: ticket.id, createdAt: ticket.createdAt, actorId: actorId ?? null, at: now() };
}

/** `fields`: names of changed ticket fields (from the history diff), e.g. ['status', 'assigneeId']. */
export function ticketUpdatedPayload({ ticketId, ticket = null, fields = [], reason, actorId = null }) {
  const changes = {};
  if (ticket) {
    for (const field of fields) {
      if (CHANGE_VALUES[field]) changes[field] = CHANGE_VALUES[field](ticket);
    }
    if (fields.includes('assigneeId')) changes.assigneeName = ticket.assigneeName ?? null;
  }
  return {
    ticketId,
    reason,
    fields: [...fields],
    changes,
    updatedAt: ticket?.updatedAt ?? null,
    actorId,
    at: now(),
  };
}

export function messageAddedPayload(message) {
  return {
    ticketId: message.ticketId,
    message: {
      id: message.id,
      kind: message.kind,
      body: message.body,
      authorId: message.authorId,
      authorName: message.authorName,
      createdAt: message.createdAt,
    },
  };
}

export function ticketDeletedPayload(ticketId, actorId) {
  return { ticketId, actorId: actorId ?? null, at: now() };
}
