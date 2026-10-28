// Convert snake_case database rows into the camelCase shapes returned by the API.

export function toUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

export function toTicket(row) {
  return {
    id: row.id,
    subject: row.subject,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name ?? null,
    createdBy: row.created_by,
    firstResponseAt: row.first_response_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isOverdue: Boolean(row.is_overdue),
    slaBreached: Boolean(row.sla_breached),
    sla: toSla(row),
    escalation: toEscalation(row),
  };
}

/** The ticket's highest recorded escalation stage, or null if it was never escalated. */
function toEscalation(row) {
  if (row.escalation_stage === undefined || row.escalation_stage === null) return null;
  return {
    stage: row.escalation_stage,
    rule: row.escalation_rule,
    escalatedAt: row.escalation_escalated_at,
    active: Boolean(row.escalation_active),
    acknowledgedAt: row.escalation_acknowledged_at,
    acknowledgedByName: row.escalation_acknowledged_by_name,
  };
}

/**
 * First-response SLA, computed by slaColumnsSql. `urgency` adds `critical` (at most 15
 * minutes left) to the business `state`, where that time still counts as `approaching`.
 */
function toSla(row) {
  if (row.sla_urgency === undefined) return null;
  return {
    state: row.sla_urgency === 'critical' ? 'approaching' : row.sla_urgency,
    urgency: row.sla_urgency,
    deadline: row.sla_deadline,
    remainingSeconds: row.sla_remaining_seconds,
    targetHours: row.sla_target_hours,
  };
}

export function toMessage(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    kind: row.kind,
    body: row.body,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
  };
}

export function toEvent(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    eventType: row.event_type,
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
    actorId: row.actor_id,
    actorName: row.actor_name ?? null,
    createdAt: row.created_at,
  };
}
