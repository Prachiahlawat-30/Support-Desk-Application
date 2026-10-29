import { canViewInternalNotes } from '../domain/access.js';
import {
  messageAddedPayload,
  SERVER_EVENTS,
  ticketCreatedPayload,
  ticketDeletedPayload,
  ticketRoom,
  ticketUpdatedPayload,
  WORKSPACE_ROOM,
} from './events.js';

// Sends real-time notifications. Services call these only after their database work has
// committed, so an event always describes a saved change. Without a Socket.IO server
// (tests that use createApp alone, CLI scripts) every call is a no-op, and a delivery
// failure is logged and never fails the request that caused it.

let io = null;

export function setRealtimeServer(server) {
  io = server;
}

function deliver(event, rooms, payload) {
  if (!io) return;
  try {
    io.to(rooms).emit(event, payload);
  } catch (err) {
    console.error(`[realtime] could not send ${event}:`, err?.message ?? err);
  }
}

export const publish = {
  ticketCreated(ticket, actorId) {
    deliver(SERVER_EVENTS.TICKET_CREATED, WORKSPACE_ROOM, ticketCreatedPayload(ticket, actorId));
  },

  ticketUpdated(args) {
    deliver(SERVER_EVENTS.TICKET_UPDATED, [ticketRoom(args.ticketId), WORKSPACE_ROOM], ticketUpdatedPayload(args));
  },

  /**
   * Visibility comes from the saved message: a public reply goes to everyone viewing the
   * ticket; an internal note only to sockets whose user may read internal notes.
   */
  async messageAdded(message) {
    if (!io) return;
    const payload = messageAddedPayload(message);
    const room = ticketRoom(message.ticketId);
    try {
      if (message.kind === 'reply') {
        io.to(room).emit(SERVER_EVENTS.MESSAGE_ADDED, payload);
        return;
      }
      const sockets = await io.in(room).fetchSockets();
      for (const socket of sockets) {
        if (canViewInternalNotes(socket.data.user)) socket.emit(SERVER_EVENTS.MESSAGE_ADDED, payload);
      }
    } catch (err) {
      console.error(`[realtime] could not send ${SERVER_EVENTS.MESSAGE_ADDED}:`, err?.message ?? err);
    }
  },

  ticketDeleted(ticketId, actorId) {
    deliver(SERVER_EVENTS.TICKET_DELETED, [ticketRoom(ticketId), WORKSPACE_ROOM], ticketDeletedPayload(ticketId, actorId));
  },
};
