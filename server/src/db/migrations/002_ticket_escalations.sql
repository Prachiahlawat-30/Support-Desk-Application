-- SLA escalations: one row per ticket and escalation stage, written by the escalation
-- check (services/escalationService.js). The unique constraint is what makes the check
-- idempotent, also when several checks run at the same time.
-- Whether an escalation is still active is not stored: it is active while the ticket is
-- still waiting for its first public reply (see escalationActiveSql in domain/rules.js).

CREATE TABLE ticket_escalations (
  id              SERIAL PRIMARY KEY,
  ticket_id       INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  stage           SMALLINT NOT NULL CHECK (stage IN (1, 2)),
  rule            TEXT NOT NULL,
  sla_deadline    TIMESTAMPTZ NOT NULL,
  escalated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT ticket_escalations_once_per_stage UNIQUE (ticket_id, stage)
);
