// Mirrors server/src/realtime/events.js (event names only); a server test checks they match.
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
