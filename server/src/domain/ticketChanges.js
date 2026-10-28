import { EVENT_TYPES } from './constants.js';

// Fields whose changes are written to the activity history. `display` turns the
// value into the text stored in the event (description is too long to keep).
const TRACKED_FIELDS = [
  { field: 'status', eventType: EVENT_TYPES.STATUS_CHANGED },
  { field: 'priority', eventType: EVENT_TYPES.PRIORITY_CHANGED },
  { field: 'assigneeId', eventType: EVENT_TYPES.ASSIGNEE_CHANGED, display: (t) => t.assigneeName ?? null },
  { field: 'subject', eventType: EVENT_TYPES.FIELD_UPDATED },
  { field: 'customerName', eventType: EVENT_TYPES.FIELD_UPDATED },
  { field: 'customerEmail', eventType: EVENT_TYPES.FIELD_UPDATED },
  { field: 'description', eventType: EVENT_TYPES.FIELD_UPDATED, display: () => null },
];

/**
 * Compares two versions of a ticket and returns one history entry per changed field:
 * `{ eventType, field, oldValue, newValue }`. Returns [] when nothing changed.
 */
export function diffTicket(before, after) {
  return TRACKED_FIELDS.filter(({ field }) => (before[field] ?? null) !== (after[field] ?? null)).map(
    ({ field, eventType, display = (t) => t[field] ?? null }) => ({
      eventType,
      field: eventType === EVENT_TYPES.FIELD_UPDATED ? field : null,
      oldValue: display(before),
      newValue: display(after),
    }),
  );
}
