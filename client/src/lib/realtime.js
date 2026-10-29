import { CLIENT_EVENTS, SERVER_EVENTS } from './realtimeEvents.js';

// Connection manager for real-time ticket notifications, independent of React and of
// Socket.IO itself (`connect` creates the socket), so it can be tested with a fake socket.
// One manager holds one connection for the whole session. Components subscribe to tickets
// and events through it; nothing here writes data, all writes stay on the REST API.
//
// Status: 'offline' (not started, stopped, or rejected) -> 'connecting' -> 'connected';
// while Socket.IO retries after a drop it is 'reconnecting'.

const AUTH_CODES = new Set(['UNAUTHORIZED']);

export function createRealtimeClient({ connect, onAuthError = () => {}, logger = console }) {
  let socket = null;
  let status = 'offline';
  let hasConnected = false;
  const statusListeners = new Set();
  const resyncListeners = new Set();
  const handlers = new Map(Object.values(SERVER_EVENTS).map((event) => [event, new Set()]));
  const subscriptions = new Map(); // ticketId -> number of components viewing it
  const subscribeErrors = new Map(); // ticketId -> Set of error callbacks

  function setStatus(next) {
    if (next === status) return;
    status = next;
    statusListeners.forEach((listener) => listener(status));
  }

  function dispatch(event, payload) {
    for (const handler of handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch (err) {
        logger.error(`[realtime] ${event} handler failed:`, err?.message ?? err);
      }
    }
  }

  function requestSubscribe(ticketId) {
    socket.emit(CLIENT_EVENTS.SUBSCRIBE, { ticketId }, (ack) => {
      if (ack?.ok) return;
      subscribeErrors.get(ticketId)?.forEach((callback) => callback(ack?.error ?? { code: 'UNKNOWN' }));
    });
  }

  function start() {
    if (socket) return;
    hasConnected = false;
    setStatus('connecting');
    socket = connect();

    socket.on('connect', () => {
      setStatus('connected');
      // Rooms do not survive a reconnect: rejoin every ticket still on screen.
      for (const ticketId of subscriptions.keys()) requestSubscribe(ticketId);
      // Events may have been missed while disconnected; let pages reload from the API.
      if (hasConnected) resyncListeners.forEach((listener) => listener());
      hasConnected = true;
    });

    socket.on('disconnect', (reason) => {
      if (reason === 'io client disconnect') return setStatus('offline');
      if (reason === 'io server disconnect') {
        // The server ended the session (e.g. the token expired): do not retry blindly.
        setStatus('offline');
        return onAuthError();
      }
      return setStatus('reconnecting');
    });

    socket.on('connect_error', (err) => {
      if (AUTH_CODES.has(err?.data?.code) || AUTH_CODES.has(err?.message)) {
        setStatus('offline');
        return onAuthError();
      }
      return setStatus(socket?.active ? 'reconnecting' : 'offline');
    });

    for (const event of Object.values(SERVER_EVENTS)) socket.on(event, (payload) => dispatch(event, payload));
  }

  function stop() {
    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      socket = null;
    }
    setStatus('offline');
  }

  /** Joins a ticket's room while at least one caller needs it. Returns the release function. */
  function subscribeTicket(ticketId, onError) {
    const count = subscriptions.get(ticketId) ?? 0;
    subscriptions.set(ticketId, count + 1);
    if (onError) {
      if (!subscribeErrors.has(ticketId)) subscribeErrors.set(ticketId, new Set());
      subscribeErrors.get(ticketId).add(onError);
    }
    if (count === 0 && socket?.connected) requestSubscribe(ticketId);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (onError) subscribeErrors.get(ticketId)?.delete(onError);
      const remaining = (subscriptions.get(ticketId) ?? 1) - 1;
      if (remaining > 0) return subscriptions.set(ticketId, remaining);
      subscriptions.delete(ticketId);
      subscribeErrors.delete(ticketId);
      if (socket?.connected) socket.emit(CLIENT_EVENTS.UNSUBSCRIBE, { ticketId });
    };
  }

  /** Listens for a server event. Registering the same function twice has no extra effect. */
  function on(event, handler) {
    const set = handlers.get(event);
    if (!set) throw new Error(`Unknown real-time event: ${event}`);
    set.add(handler);
    return () => set.delete(handler);
  }

  function onStatus(listener) {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
  }

  /** Called after a reconnect, so pages can reload anything they may have missed. */
  function onResync(listener) {
    resyncListeners.add(listener);
    return () => resyncListeners.delete(listener);
  }

  return {
    start,
    stop,
    subscribeTicket,
    on,
    onStatus,
    onResync,
    getStatus: () => status,
    // For tests and diagnostics.
    subscribedTickets: () => [...subscriptions.keys()],
    listenerCount: (event) => handlers.get(event)?.size ?? 0,
  };
}
