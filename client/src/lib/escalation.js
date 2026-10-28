// SLA escalation wording. Stages and rules mirror server/src/domain/constants.js
// (ESCALATION_STAGES); whether and when a ticket escalates is decided only by the server.

export const ESCALATION_LABELS = { 1: 'Escalated', 2: 'Senior attention' };

export function escalationReason(rule, level2Hours) {
  if (rule === 'first_response_sla_breached') return 'The first-response SLA deadline passed without a public reply.';
  if (rule === 'first_response_still_missing') {
    return `Still no public reply ${level2Hours ? `${level2Hours}h ` : ''}after the first-response deadline.`;
  }
  return 'Escalated by the SLA escalation check.';
}
