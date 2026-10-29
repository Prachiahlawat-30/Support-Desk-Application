import { useEffect, useRef, useState } from 'react';
import { realtime } from '../lib/socket.js';
import { SERVER_EVENTS } from '../lib/realtimeEvents.js';
import { debounce } from '../lib/ticketUpdates.js';

// React bindings for the shared real-time connection. Handlers are kept in refs, so a
// re-render never registers a second listener, and every effect removes what it added.

/** 'connecting' | 'connected' | 'reconnecting' | 'offline' */
export function useRealtimeStatus() {
  const [status, setStatus] = useState(realtime.getStatus);
  useEffect(() => {
    setStatus(realtime.getStatus());
    return realtime.onStatus(setStatus);
  }, []);
  return status;
}

/**
 * Live updates for one ticket while it is on screen: joins its room, routes its events
 * to the handlers, and calls `onResync` after a reconnect.
 */
export function useTicketRealtime(ticketId, handlers) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!Number.isInteger(ticketId) || ticketId <= 0) return undefined;
    const forThisTicket = (key) => (payload) => {
      if (payload?.ticketId === ticketId) ref.current[key]?.(payload);
    };
    const offs = [
      realtime.subscribeTicket(ticketId, (error) => ref.current.onSubscribeError?.(error)),
      realtime.on(SERVER_EVENTS.TICKET_UPDATED, forThisTicket('onUpdated')),
      realtime.on(SERVER_EVENTS.MESSAGE_ADDED, forThisTicket('onMessage')),
      realtime.on(SERVER_EVENTS.TICKET_DELETED, forThisTicket('onDeleted')),
      realtime.onResync(() => ref.current.onResync?.()),
    ];
    return () => offs.forEach((off) => off());
  }, [ticketId]);
}

/**
 * Calls `onChange` (debounced) when any ticket is created, updated or deleted, or after a
 * reconnect. Used by lists and the dashboard, which then reload through the API.
 */
export function useWorkspaceChanges(onChange, { delayMs = 600 } = {}) {
  const ref = useRef(onChange);
  ref.current = onChange;

  useEffect(() => {
    const run = debounce(() => ref.current(), delayMs);
    const offs = [
      realtime.on(SERVER_EVENTS.TICKET_CREATED, run),
      realtime.on(SERVER_EVENTS.TICKET_UPDATED, run),
      realtime.on(SERVER_EVENTS.TICKET_DELETED, run),
      realtime.onResync(run),
    ];
    return () => {
      offs.forEach((off) => off());
      run.cancel();
    };
  }, [delayMs]);
}
