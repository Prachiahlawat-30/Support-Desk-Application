# Support Desk System

A mini customer-support platform designed for support teams to receive, organise, assign, track, and resolve customer issues. Built with modern full-stack fundamentals, robust data handling, real-time synchronization, and a clean, accessible interface.

**Stack:** React 18 (Vite) · Node.js & Express 5 · PostgreSQL · Socket.IO · Tailwind-free custom CSS design system

---

## 1. Quick Start

### Prerequisites
- **Node.js**: v20 or newer
- **PostgreSQL**: v13 or newer (local or cloud instance like Neon)

### Installation & Setup

1. **Clone & Install Dependencies** (root, client, and server):
   ```bash
   npm run install:all
   ```

2. **Configure Environment Variables**:
   Copy the example environment file and update database credentials:
   ```bash
   cp server/.env.example server/.env
   ```
   *Edit `server/.env` to configure your `DATABASE_URL` and `TEST_DATABASE_URL`.*

3. **Initialize Database & Seed Data**:
   Creates databases, executes SQL migrations, and seeds demo accounts and tickets:
   ```bash
   npm run db:setup
   ```

4. **Start Application** (API and frontend concurrently):
   ```bash
   npm run dev
   ```
   - **Frontend**: [http://localhost:5173](http://localhost:5173)
   - **API Backend**: [http://localhost:4000](http://localhost:4000)

---

## 2. Demo Credentials

The database is pre-seeded with role-based accounts for testing:

| Role | Email | Password | Permissions |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin@demo.test` | `admin123` | Full access, ticket deletion, analytics dashboard |
| **Agent** | `priya@demo.test` | `agent123` | Ticket management, replies/notes, assignment |
| **Agent** | `sam@demo.test` | `agent123` | Ticket management, replies/notes, assignment |

*Quick login buttons are available directly on the login screen.*

---

## 3. Environment Variables Reference (`server/.env`)

| Variable | Required | Default | Purpose |
| :--- | :---: | :---: | :--- |
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string for the main application |
| `TEST_DATABASE_URL` | For tests | — | Isolated database for integration tests (wiped on test runs) |
| `JWT_SECRET` | Production | `dev-secret` | Secret key used to sign and verify JWT authentication tokens |
| `PORT` | No | `4000` | Port for the Express API server |
| `CORS_ORIGIN` | No | `http://localhost:5173` | Allowed browser origin for CORS and WebSockets |
| `SLA_FIRST_RESPONSE_HOURS` | No | `4` | SLA response-time target for initial public reply (in hours) |
| `SLA_ESCALATION_LEVEL2_HOURS` | No | `2` | Hours after missed SLA deadline before escalating to Senior Attention |
| `OPENAI_API_KEY` | Optional | — | OpenAI API key for AI Copilot and Draft Reply Assistant |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Chat completion model supporting Structured Outputs |

---

## 4. Key Features & Business Rules

### Core Requirements

- **Ticket Management**:
  - Full creation flow capturing subject, customer identifier (name and/or email), description, priority, status, and assignee.
  - Comprehensive ticket list with instant visual indicators for status, priority, SLA countdown, and assignee.
  - Full detail view supporting inline editing of content and instantaneous property updates (status, priority, assignee).
  - Supported statuses: `Open`, `In Progress`, `Waiting on Customer`, `Resolved`.
  - Supported priorities: `Low`, `Medium`, `High`, `Urgent`.

- **Replies & Internal Notes**:
  - Distinct separation between customer-facing **Public Replies** and **Internal Notes**.
  - Internal notes are visually demarcated in warm amber with a lock icon (`🔒`) and tag *"Only visible to the support team"*.
  - Independent draft states in the composer prevent accidental cross-posting of notes as replies.
  - Messages rendered in strict chronological order with author details, avatar initials, and formatted timestamps.

- **Search, Filters & Sorting**:
  - Debounced multi-field search querying `subject`, `customer_name`, and `customer_email`.
  - Filter by status, priority, assignee (including "Assigned to me" and "Unassigned"), and overdue condition.
  - Multi-filter combinations supported simultaneously.
  - Sort by recently updated, priority hierarchy (`Urgent > High > Medium > Low`), or creation date.
  - Filter state synchronized to URL search query parameters for shareable and bookmarkable views.

- **Activity History & Audit Trail**:
  - Complete chronological timeline of all ticket events: creation, status transitions, priority updates, assignments, description/subject edits, and replies/notes.
  - Captures actor identity, previous value, new value, and exact timestamp.

- **Dashboard & Performance Overview**:
  - Live metric cards: Total, Open, In Progress, Waiting on Customer, and Resolved tickets.
  - Dedicated "Needs Attention" panel highlighting Urgent tickets, Overdue items, and SLA breaches.
  - Metrics computed directly from PostgreSQL (`FILTER` clauses) reflecting real saved data.
  - Dedicated **Overdue Tickets** section listing tickets requiring immediate intervention.

### Business Rules & Data Integrity

- **Required Fields**: Subject and description are mandatory; at least one customer identifier (name or email) is enforced across client validation, server middleware, and PostgreSQL table `CHECK` constraints.
- **Overdue Definition**: A ticket is overdue if `status <> 'Resolved'` and `created_at < now() - INTERVAL '24 hours'`. Highlighted with red visual row accents and dedicated filter/table.
- **Resolution Behavior**: Marking a ticket `Resolved` immediately removes it from Open, In Progress, and Overdue counts, setting `resolved_at` (cleared if reopened).
- **Deletion & Cascading**: Only Admins may delete tickets (`requireRole('admin')`). Replies, notes, and activity events cascade-delete (`ON DELETE CASCADE`) to prevent orphaned records.

### Stretch Goals & Advanced Features

- **JWT Authentication & RBAC**: Demo auth with scrypt password hashing, signed JWTs, and role boundaries between `admin` and `agent`.
- **Server-Side Pagination**: Efficient pagination for ticket listings with configurable page size.
- **First-Response SLA Engine**: Dynamic first-response SLA tracking with configurable threshold, client-side countdown timers, approaching/critical warnings, and breach indicators.
- **Two-Stage Escalation Scheduler**: Automatic progression to Stage 1 (Escalated) upon breach and Stage 2 (Senior Attention) if still unattended, complete with acknowledgment workflows.
- **Real-Time Synchronization (Socket.IO)**: Live multi-user updates for ticket edits, replies, notes, assignments, and status changes without manual polling.
- **AI Support Copilot & Reply Assistant**: Optional AI analysis for sentiment, category, and action recommendation, plus an assistive draft reply generator (requires `OPENAI_API_KEY`).
- **Support Analytics & CSV Export**: Admin-only reporting suite providing trend charts, resolution performance, agent attribution, and formula-sanitized CSV exports.

---

## 5. System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   React 18 SPA (Vite)                  │
│       Dashboard · Ticket List · Detail · Analytics     │
└───────────────┬────────────────────────▲───────────────┘
                │ REST API (JSON)        │ WebSocket (Socket.IO)
                ▼                        │
┌────────────────────────────────────────┴───────────────┐
│                 Express 5 API Server                   │
│   Auth Middleware · Input Validation · Route Handlers  │
└───────────────┬────────────────────────────────────────┘
                │
        ┌───────┴───────┐
        ▼               ▼
┌──────────────┐  ┌──────────────────────────────────────┐
│ Domain Rules │  │          PostgreSQL Database         │
│  (SQL Logic) │  │  users · tickets · ticket_messages   │
└──────────────┘  │  ticket_events · ticket_escalations  │
                  └──────────────────────────────────────┘
```

### Architectural Principles

1. **Single Source of Truth for Rules**:
   Business rules (overdue calculations, SLA deadlines, escalation criteria, priority rankings) are centralized as pure SQL fragments in [`server/src/domain/rules.js`](server/src/domain/rules.js). The dashboard, filter queries, and detail endpoints evaluate identical SQL definitions.

2. **Transactional Event Logging**:
   Ticket modifications execute within atomic database transactions (`withTransaction`). Row locking (`SELECT ... FOR UPDATE`) prevents race conditions, and changes are diffed via [`diffTicket()`](server/src/domain/ticketChanges.js) to emit granular event records within the same transaction.

3. **Defensive Multi-Layer Validation**:
   - Client-side validation for instant UX feedback.
   - Server-side validation rejecting invalid requests with structured `{ code, message, details }` payloads.
   - Database-level constraints (`CHECK`, foreign key rules) guaranteeing schema consistency even if bypassed.

4. **Security & Data Sanitization**:
   - Parameterized queries throughout prevent SQL injection.
   - Exported CSV fields are sanitized against formula injection (`=`, `+`, `-`, `@`).
   - Sensitive credentials and tokens are excluded from WebSocket event payloads.

---

## 6. Database Schema

The relational schema is defined in [`server/src/db/migrations/001_initial_schema.sql`](server/src/db/migrations/001_initial_schema.sql):

- **`users`**:
  `id`, `name`, `email` (UNIQUE), `role` (`admin` | `agent`), `password_hash`, `created_at`
- **`tickets`**:
  `id`, `subject`, `customer_name`, `customer_email`, `description`, `status`, `priority`, `assignee_id` (FK), `created_by` (FK), `first_response_at`, `resolved_at`, `created_at`, `updated_at`
- **`ticket_messages`**:
  `id`, `ticket_id` (FK, ON DELETE CASCADE), `kind` (`reply` | `note`), `body`, `author_id` (FK), `created_at`
- **`ticket_events`**:
  `id`, `ticket_id` (FK, ON DELETE CASCADE), `actor_id` (FK), `event_type`, `field`, `old_value`, `new_value`, `created_at`
- **`ticket_escalations`**:
  `id`, `ticket_id` (FK, ON DELETE CASCADE), `stage`, `rule`, `escalated_at`, `acknowledged_at`, `acknowledged_by` (FK)

---

## 7. API Reference

All protected endpoints require an `Authorization: Bearer <token>` header.

| Method | Endpoint | Description | Access |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Authenticate and obtain JWT token | Public |
| `GET` | `/api/auth/me` | Fetch authenticated user profile | Authenticated |
| `GET` | `/api/agents` | List active support agents for assignment | Authenticated |
| `GET` | `/api/dashboard` | Aggregated metric counts and overdue tickets | Authenticated |
| `GET` | `/api/tickets` | Query tickets with search, filters, sorting & pagination | Authenticated |
| `POST` | `/api/tickets` | Create a new support ticket | Authenticated |
| `GET` | `/api/tickets/:id` | Fetch ticket detail with messages and history | Authenticated |
| `PATCH` | `/api/tickets/:id` | Update ticket fields (status, priority, assignee, details) | Authenticated |
| `DELETE` | `/api/tickets/:id` | Delete ticket and cascade associated data | **Admin Only** |
| `POST` | `/api/tickets/:id/messages` | Add a public reply or internal note | Authenticated |
| `POST` | `/api/tickets/:id/escalation/acknowledge` | Acknowledge active escalation stage | Authenticated |
| `GET` | `/api/analytics/overview` | SLA compliance, volume trends, and status distribution | **Admin Only** |
| `GET` | `/api/analytics/agents` | Agent resolution metrics and SLA adherence | **Admin Only** |
| `GET` | `/api/analytics/export` | Download CSV reports (`summary`, `trend`, `agents`) | **Admin Only** |
| `POST` | `/api/tickets/:id/analyze` | AI analysis for sentiment, category, and action | Authenticated |
| `POST` | `/api/tickets/:id/draft-reply` | Generate an AI response draft for agent review | Authenticated |

---

## 8. Testing & Reliability

The test suite leverages Node.js's native test runner (`node:test`) and covers both unit and integration flows:

```bash
# Execute unit and database integration tests
npm test
```

- **Unit Tests** (`server/tests/unit`):
  - Pure input validation rules ([`ticketValidation.test.js`](server/tests/unit/ticketValidation.test.js)).
  - History diff logic ([`ticketChanges.test.js`](server/tests/unit/ticketChanges.test.js)).
  - Query parameter parser ([`listQuery.test.js`](server/tests/unit/listQuery.test.js)).
  - Dashboard metric card mapping ([`dashboardCards.test.js`](server/tests/unit/dashboardCards.test.js)).
  - SLA client calculations and countdown thresholds ([`slaClient.test.js`](server/tests/unit/slaClient.test.js)).
- **Integration Tests** (`server/tests/integration`):
  - End-to-end API workflows with an isolated PostgreSQL database.
  - Ticket lifecycle: creation, assignment, resolution, reopening, and audit trails.
  - Replies vs. internal notes first-response attribution.
  - Authorization guards and cascade deletion verification.
  - WebSocket subscription contracts and mock AI provider pipelines.

---

## 9. Assumptions, Known Limitations & Scope

- **Email Delivery**: Replies are stored and labelled as customer-facing; actual SMTP / transactional email dispatch is omitted in favor of simulated support workflows.
- **Concurrency**: Ticket updates utilize optimistic display updates backed by pessimistic database row locking during write transactions. Simultaneous edits follow a last-write-wins policy with complete activity history capture.
- **Session Storage**: JWTs are stored in browser storage for demonstration convenience. A production deployment would leverage secure, `httpOnly`, `SameSite` cookies with refresh token rotation.
- **AI Integration**: AI features are non-destructive and advisory only. All drafts and priority recommendations require explicit agent review and submission.

---

## 10. AI Usage & Ownership Statement

An AI assistant was utilized during development to assist with boilerplate scaffolding, schema design, test generation, and review. All business logic, database queries, API contracts, and user experience flows were manually verified, tested against live PostgreSQL instances, and refined to meet the assessment requirements.
