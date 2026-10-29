import { ROLES } from './constants.js';

// Who may read what. These mirror the REST API: every signed-in support user (admin or
// agent) can open any ticket and read its internal notes. The real-time layer uses the
// same rules, so it never shows anyone more than the API would.

export function canViewTickets(user) {
  return Boolean(user) && ROLES.includes(user.role);
}

export function canViewInternalNotes(user) {
  return canViewTickets(user);
}
