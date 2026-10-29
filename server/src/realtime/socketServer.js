import { Server } from 'socket.io';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { canViewTickets } from '../domain/access.js';
import { verifyTokenClaims } from '../services/authService.js';
import { findUserById } from '../services/userService.js';
import { CLIENT_EVENTS, parseTicketIdPayload, ticketRoom, WORKSPACE_ROOM } from './events.js';
import { setRealtimeServer } from './publisher.js';

// Socket.IO on the API's own HTTP server. Sockets only ever receive notifications: they
// cannot write data, and nothing a client sends is relayed to other clients. All writes
// still go through the REST API.

const MAX_TICKET_ROOMS = 25; // per socket
const SUBSCRIBE_LIMIT = { count: 30, windowMs: 10_000 }; // subscribe requests per socket
const MAX_TIMER_MS = 2_147_483_647;

const fail = (code, message) => ({ ok: false, error: { code, message } });

/** A handshake error the client can read; it never mentions the token or the secret. */
function handshakeError(code, message) {
  const err = new Error(code);
  err.data = { code, message };
  return err;
}

/**
 * Handshake authentication with the existing JWT rules: the token comes from the
 * Socket.IO `auth` field (never the URL), and the account must still exist.
 */
async function authenticate(socket, next) {
  const token = socket.handshake.auth?.token;
  if (typeof token !== 'string' || !token || token.length > 4096) {
    return next(handshakeError('UNAUTHORIZED', 'Sign in to receive live updates.'));
  }
  let claims;
  try {
    claims = verifyTokenClaims(token);
  } catch {
    return next(handshakeError('UNAUTHORIZED', 'Your session has expired. Sign in again to receive live updates.'));
  }
  try {
    const user = await findUserById(claims.userId);
    if (!user || !canViewTickets(user)) {
      return next(handshakeError('UNAUTHORIZED', 'Your account cannot receive live updates.'));
    }
    socket.data.user = { id: user.id, name: user.name, role: user.role };
    socket.data.expiresAt = claims.expiresAt;
    return next();
  } catch (err) {
    console.error('[realtime] handshake failed:', err?.code ?? err?.message ?? 'unknown error');
    return next(handshakeError('SERVER_ERROR', 'Live updates are unavailable right now.'));
  }
}

/** Fixed-window limit on subscribe requests for one socket. */
function allowSubscribe(socket) {
  const nowMs = Date.now();
  const window = socket.data.subscribeWindow;
  if (!window || nowMs - window.start > SUBSCRIBE_LIMIT.windowMs) {
    socket.data.subscribeWindow = { start: nowMs, count: 1 };
    return true;
  }
  window.count += 1;
  return window.count <= SUBSCRIBE_LIMIT.count;
}

const ticketRoomCount = (socket) => [...socket.rooms].filter((room) => room.startsWith('ticket:')).length;

function onConnection(socket) {
  socket.join(WORKSPACE_ROOM);

  // Disconnect when the token expires; the client then asks the user to sign in again.
  if (socket.data.expiresAt) {
    const delay = Math.min(Math.max(socket.data.expiresAt - Date.now(), 0), MAX_TIMER_MS);
    socket.data.expiryTimer = setTimeout(() => socket.disconnect(true), delay);
  }
  socket.on('disconnect', () => clearTimeout(socket.data.expiryTimer));

  socket.on(CLIENT_EVENTS.SUBSCRIBE, async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    if (!allowSubscribe(socket)) return reply(fail('RATE_LIMITED', 'Too many subscription requests. Try again shortly.'));
    const ticketId = parseTicketIdPayload(payload);
    if (!ticketId) return reply(fail('BAD_REQUEST', 'A valid ticketId is required.'));
    if (socket.rooms.has(ticketRoom(ticketId))) return reply({ ok: true, ticketId });

    try {
      // Re-check the account on every subscription: removed users lose access at once.
      const user = await findUserById(socket.data.user.id);
      if (!user || !canViewTickets(user)) {
        reply(fail('UNAUTHORIZED', 'Your account cannot view this ticket.'));
        socket.disconnect(true);
        return;
      }
      socket.data.user = { id: user.id, name: user.name, role: user.role };
      const { rowCount } = await query('SELECT 1 FROM tickets WHERE id = $1', [ticketId]);
      if (rowCount === 0) return reply(fail('NOT_FOUND', `Ticket #${ticketId} was not found.`));
      if (ticketRoomCount(socket) >= MAX_TICKET_ROOMS) {
        return reply(fail('TOO_MANY_SUBSCRIPTIONS', 'Too many tickets open at once.'));
      }
      await socket.join(ticketRoom(ticketId));
      return reply({ ok: true, ticketId });
    } catch (err) {
      console.error('[realtime] subscribe failed:', err?.code ?? err?.message ?? 'unknown error');
      return reply(fail('SERVER_ERROR', 'Could not subscribe right now.'));
    }
  });

  socket.on(CLIENT_EVENTS.UNSUBSCRIBE, async (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const ticketId = parseTicketIdPayload(payload);
    if (!ticketId) return reply(fail('BAD_REQUEST', 'A valid ticketId is required.'));
    await socket.leave(ticketRoom(ticketId));
    return reply({ ok: true, ticketId });
  });
}

/** Attaches Socket.IO to `httpServer` and makes it the publisher's target. */
export function attachRealtime(httpServer, { corsOrigin = config.corsOrigin } = {}) {
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin, methods: ['GET', 'POST'] },
    serveClient: false,
    maxHttpBufferSize: 10_000, // clients only send tiny subscribe requests
  });
  io.use(authenticate);
  io.on('connection', onConnection);
  setRealtimeServer(io);
  return io;
}
