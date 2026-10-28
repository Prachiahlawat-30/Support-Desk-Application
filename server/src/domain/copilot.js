// AI Support Copilot: the vocabulary the model must answer in, and the bounds on
// what we send to it and accept back from it.

/** Supported categories, with the guidance given to the model for each. */
export const COPILOT_CATEGORIES = {
  Payment: 'A payment failed, was declined, charged twice or is missing',
  Billing: 'Invoices, refunds, pricing questions or wrong amounts',
  Subscription: 'Plan changes, renewals, upgrades, downgrades or cancellation',
  'Account Access': 'Login, password reset, two-factor authentication or locked accounts',
  'Technical Issue': 'Something is slow, unavailable or misconfigured',
  'Bug Report': 'The product behaves incorrectly or crashes',
  'Feature Request': 'The customer asks for new or changed functionality',
  'General Inquiry': 'How-to questions and requests for information',
  Other: 'Anything that fits none of the categories above',
};
export const CATEGORIES = Object.keys(COPILOT_CATEGORIES);

export const SENTIMENTS = ['positive', 'neutral', 'frustrated', 'angry', 'distressed'];

/** Maximum lengths accepted from the model. Longer values fail validation. */
export const ANALYSIS_LIMITS = {
  summary: 600,
  subcategory: 60,
  recommendedAction: 500,
  reasoning: 800,
};

/**
 * Bounds on the ticket content sent to the provider. The conversation is reduced to
 * its most recent messages, each truncated, so the request size is predictable.
 */
export const CONTEXT_LIMITS = {
  subject: 200,
  description: 4_000,
  recentMessages: 8,
  messageBody: 1_000,
};

/** AI Reply Assistant: the longest draft accepted from the model. */
export const DRAFT_MAX_LENGTH = 4_000;
