import { PRIORITIES } from '../domain/constants.js';
import { ANALYSIS_LIMITS, CATEGORIES, DRAFT_MAX_LENGTH, SENTIMENTS } from '../domain/copilot.js';

// The model's answer is untrusted: it is checked field by field before anything is
// returned to the browser. Unknown properties are dropped; nothing is filled in.

function text(errors, input, field, max) {
  const raw = input[field];
  if (typeof raw !== 'string' || !raw.trim()) {
    errors[field] = 'must be a non-empty string';
    return null;
  }
  const value = raw.trim();
  if (value.length > max) errors[field] = `must be at most ${max} characters`;
  return value;
}

function oneOf(errors, input, field, allowed) {
  const value = input[field];
  if (!allowed.includes(value)) errors[field] = `must be one of: ${allowed.join(', ')}`;
  return value;
}

/** Validates a parsed model response. Returns `{ value, errors }` like the other validators. */
export function validateAnalysis(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { value: null, errors: { body: 'must be a JSON object' } };
  }
  const errors = {};
  const value = {
    summary: text(errors, input, 'summary', ANALYSIS_LIMITS.summary),
    category: oneOf(errors, input, 'category', CATEGORIES),
    subcategory: text(errors, input, 'subcategory', ANALYSIS_LIMITS.subcategory),
    sentiment: oneOf(errors, input, 'sentiment', SENTIMENTS),
    suggestedPriority: oneOf(errors, input, 'suggestedPriority', PRIORITIES),
    recommendedAction: text(errors, input, 'recommendedAction', ANALYSIS_LIMITS.recommendedAction),
    reasoning: text(errors, input, 'reasoning', ANALYSIS_LIMITS.reasoning),
  };
  return Object.keys(errors).length ? { value: null, errors } : { value, errors: null };
}

/** Validates a parsed reply-draft response `{ draft }`. */
export function validateDraft(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { value: null, errors: { draft: 'is not a JSON object' } };
  }
  const raw = input.draft;
  if (typeof raw !== 'string' || !raw.trim()) return { value: null, errors: { draft: 'is empty' } };
  const draft = raw.trim();
  if (draft.length > DRAFT_MAX_LENGTH) {
    return { value: null, errors: { draft: `is longer than ${DRAFT_MAX_LENGTH} characters` } };
  }
  if (/ticket_data|internal_note|agent_reply/i.test(draft)) {
    return { value: null, errors: { draft: 'contains prompt or internal labels' } };
  }
  return { value: { draft }, errors: null };
}
