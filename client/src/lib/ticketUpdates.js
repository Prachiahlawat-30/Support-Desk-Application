// Pure helpers that apply real-time events to ticket state held in React. The REST API
// stays authoritative: pages also reload from it shortly after an event.

const LIVE_FIELDS = ['status', 'priority', 'assigneeId', 'assigneeName', 'subject'];

/** Applies a ticket:updated payload to a loaded ticket (other tickets are returned unchanged). */
export function applyTicketChanges(ticket, payload) {
  if (!ticket || !payload || payload.ticketId !== ticket.id) return ticket;
  const changes = payload.changes ?? {};
  const next = { ...ticket };
  let changed = false;
  for (const field of LIVE_FIELDS) {
    if (Object.hasOwn(changes, field) && next[field] !== changes[field]) {
      next[field] = changes[field];
      changed = true;
    }
  }
  if (payload.updatedAt && payload.updatedAt !== ticket.updatedAt) {
    next.updatedAt = payload.updatedAt;
    changed = true;
  }
  return changed ? next : ticket;
}

/** Adds a ticket:message_added message once, keeping the conversation in order. */
export function appendMessage(ticket, payload) {
  const message = payload?.message;
  if (!ticket || !message || payload.ticketId !== ticket.id) return ticket;
  if (ticket.messages.some((m) => m.id === message.id)) return ticket;
  const messages = [...ticket.messages, { ...message, ticketId: payload.ticketId }].sort(
    (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id - b.id,
  );
  return { ...ticket, messages };
}

/** Returns a function that runs `fn` once, `delayMs` after the last of several quick calls. */
export function debounce(fn, delayMs) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, delayMs);
  };
  debounced.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return debounced;
}
