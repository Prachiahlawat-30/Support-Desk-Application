// Mirrors server/src/domain/constants.js.
export const STATUSES = ['Open', 'In Progress', 'Waiting on Customer', 'Resolved'];
export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

export const SORT_OPTIONS = [
  { value: 'updated', label: 'Recently updated' },
  { value: 'priority', label: 'Priority (highest first)' },
  { value: 'created', label: 'Newest first' },
];

export const LIMITS = { subject: 200, customerName: 120, customerEmail: 254, description: 10000, messageBody: 10000 };

/** CSS modifier for a status or priority, e.g. "In Progress" -> "in-progress". */
export const slug = (value) => value.toLowerCase().replace(/\s+/g, '-');
