import { LIMITS } from './constants.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client-side copy of the server's ticket rules, for instant feedback.
 * The server validates again and remains the source of truth.
 */
export function validateTicketForm(values) {
  const errors = {};
  const subject = values.subject.trim();
  const name = values.customerName.trim();
  const email = values.customerEmail.trim();
  const description = values.description.trim();

  if (!subject) errors.subject = 'Subject is required';
  else if (subject.length > LIMITS.subject) errors.subject = `Subject must be at most ${LIMITS.subject} characters`;

  if (name.length > LIMITS.customerName) errors.customerName = `Name must be at most ${LIMITS.customerName} characters`;
  if (email && !EMAIL_RE.test(email)) errors.customerEmail = 'Enter a valid email address';
  if (!name && !email) errors.customer = 'Provide a customer name or email';

  if (!description) errors.description = 'Description is required';
  else if (description.length > LIMITS.description) {
    errors.description = `Description must be at most ${LIMITS.description} characters`;
  }
  return errors;
}
