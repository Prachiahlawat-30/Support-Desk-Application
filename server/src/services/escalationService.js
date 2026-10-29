import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { ESCALATION_STAGES } from '../domain/constants.js';
import { escalationDueSql, slaDeadlineSql } from '../domain/rules.js';
import { UPDATE_REASONS } from '../realtime/events.js';
import { publish } from '../realtime/publisher.js';
import { notFound } from '../utils/httpError.js';

// SLA escalation. The check records each stage a ticket reaches, once: the
// UNIQUE (ticket_id, stage) constraint plus ON CONFLICT DO NOTHING make re-runs, restarts
// and overlapping checks (also from several server instances) safe. It changes nothing
// else on the ticket: no assignment, priority, status or messages.

const BATCH_SIZE = 500;

const stageLabel = (stage) => `Level ${stage}: ${ESCALATION_STAGES[stage].label}`;

/**
 * Records one escalation stage for up to BATCH_SIZE due tickets, and writes the matching
 * history event, in a single statement (so both are written or neither is).
 * Returns the ids of the tickets escalated by this call.
 */
async function escalateBatch(stage, now) {
  const { slaFirstResponseHours: slaHours } = config;
  const nowSql = 'coalesce($1::timestamptz, now())';
  const { rows } = await query(
    `WITH due AS (
       SELECT t.id, ${slaDeadlineSql(slaHours, 't')} AS deadline
       FROM tickets t
       WHERE ${escalationDueSql(stage, slaHours, config.escalation.level2Hours, 't', nowSql)}
         AND NOT EXISTS (SELECT 1 FROM ticket_escalations e WHERE e.ticket_id = t.id AND e.stage = $2)
       ORDER BY t.id
       LIMIT $3
     ),
     inserted AS (
       INSERT INTO ticket_escalations (ticket_id, stage, rule, sla_deadline, escalated_at)
       SELECT id, $2, $4, deadline, ${nowSql} FROM due
       ON CONFLICT (ticket_id, stage) DO NOTHING
       RETURNING ticket_id
     ),
     logged AS (
       INSERT INTO ticket_events (ticket_id, actor_id, event_type, new_value, created_at)
       SELECT ticket_id, NULL, 'escalated', $5, ${nowSql} FROM inserted
     )
     SELECT ticket_id FROM inserted ORDER BY ticket_id`,
    [now, stage, BATCH_SIZE, ESCALATION_STAGES[stage].rule, stageLabel(stage)],
  );
  return rows.map((r) => r.ticket_id);
}

/**
 * Checks every ticket and records the escalation stages that are due. Safe to run any
 * number of times. `now` is only for tests; the scheduler uses the database clock.
 * A failing stage is logged and reported without affecting the other stage.
 */
export async function runEscalationCheck({ now = null } = {}) {
  const result = { escalated: [], failedStages: [], checkedAt: (now ?? new Date()).toISOString() };
  for (const stage of [1, 2]) {
    try {
      for (;;) {
        const ids = await escalateBatch(stage, now);
        result.escalated.push(...ids.map((ticketId) => ({ ticketId, stage })));
        // Each batch is one committed statement, so viewers can be told right away.
        for (const ticketId of ids) {
          publish.ticketUpdated({ ticketId, fields: ['escalation'], reason: UPDATE_REASONS.ESCALATION });
        }
        if (ids.length < BATCH_SIZE) break;
      }
    } catch (err) {
      console.error(`[escalation] stage ${stage} check failed:`, err.code ?? '', err.message);
      result.failedStages.push(stage);
    }
  }
  return result;
}

/** A ticket's escalation records, lowest stage first. */
export async function listEscalations(ticketId, db = { query }) {
  const { rows } = await db.query(
    `SELECT e.stage, e.rule, e.sla_deadline, e.escalated_at, e.acknowledged_at, u.name AS acknowledged_by_name
     FROM ticket_escalations e LEFT JOIN users u ON u.id = e.acknowledged_by
     WHERE e.ticket_id = $1 ORDER BY e.stage`,
    [ticketId],
  );
  return rows.map((r) => ({
    stage: r.stage,
    label: ESCALATION_STAGES[r.stage]?.label ?? `Level ${r.stage}`,
    rule: r.rule,
    slaDeadline: r.sla_deadline,
    escalatedAt: r.escalated_at,
    acknowledgedAt: r.acknowledged_at,
    acknowledgedByName: r.acknowledged_by_name,
  }));
}

/**
 * Acknowledges every unacknowledged escalation of a ticket for `user`, with one history
 * event. Acknowledging again changes nothing and writes no event. It does not change
 * the ticket itself.
 */
export async function acknowledgeEscalations(ticketId, user) {
  const result = await withTransaction(async (db) => {
    const ticket = await db.query('SELECT 1 FROM tickets WHERE id = $1 FOR UPDATE', [ticketId]);
    if (ticket.rowCount === 0) throw notFound(`Ticket #${ticketId} was not found`);

    const { rows } = await db.query(
      `UPDATE ticket_escalations SET acknowledged_at = now(), acknowledged_by = $2
       WHERE ticket_id = $1 AND acknowledged_at IS NULL
       RETURNING stage`,
      [ticketId, user.id],
    );
    const stages = rows.map((r) => r.stage).sort();
    if (stages.length) {
      await db.query(
        `INSERT INTO ticket_events (ticket_id, actor_id, event_type, new_value)
         VALUES ($1, $2, 'escalation_acknowledged', $3)`,
        [ticketId, user.id, stageLabel(Math.max(...stages))],
      );
    }
    return { acknowledgedStages: stages, escalations: await listEscalations(ticketId, db) };
  });
  if (result.acknowledgedStages.length) {
    publish.ticketUpdated({
      ticketId,
      fields: ['escalation'],
      reason: UPDATE_REASONS.ESCALATION_ACKNOWLEDGED,
      actorId: user.id,
    });
  }
  return result;
}
