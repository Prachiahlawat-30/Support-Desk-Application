-- Support desk schema.
-- Enumerations are stored as TEXT guarded by CHECK constraints: easy to read in SQL
-- and simple to extend with a new migration.

CREATE TABLE users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL CHECK (role IN ('admin', 'agent')),
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
  id                SERIAL PRIMARY KEY,
  subject           TEXT NOT NULL CHECK (length(btrim(subject)) > 0),
  customer_name     TEXT,
  customer_email    TEXT,
  description       TEXT NOT NULL CHECK (length(btrim(description)) > 0),
  status            TEXT NOT NULL DEFAULT 'Open'
                    CHECK (status IN ('Open', 'In Progress', 'Waiting on Customer', 'Resolved')),
  priority          TEXT NOT NULL DEFAULT 'Medium'
                    CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  assignee_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  first_response_at TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tickets_customer_required CHECK (
    coalesce(btrim(customer_name), '') <> '' OR coalesce(btrim(customer_email), '') <> ''
  )
);

CREATE INDEX tickets_status_idx     ON tickets (status);
CREATE INDEX tickets_priority_idx   ON tickets (priority);
CREATE INDEX tickets_assignee_idx   ON tickets (assignee_id);
CREATE INDEX tickets_updated_at_idx ON tickets (updated_at DESC);
CREATE INDEX tickets_created_at_idx ON tickets (created_at);

-- Public replies and internal notes. Deleted together with their ticket.
CREATE TABLE ticket_messages (
  id         SERIAL PRIMARY KEY,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('reply', 'note')),
  body       TEXT NOT NULL CHECK (length(btrim(body)) > 0),
  author_id  INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ticket_messages_ticket_idx ON ticket_messages (ticket_id, created_at, id);

-- Activity history. Old/new values are stored as display text so history stays
-- readable even if, e.g., an agent is later renamed.
CREATE TABLE ticket_events (
  id         SERIAL PRIMARY KEY,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  field      TEXT,
  old_value  TEXT,
  new_value  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ticket_events_ticket_idx ON ticket_events (ticket_id, created_at, id);
