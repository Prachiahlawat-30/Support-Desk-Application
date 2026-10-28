import { hashPassword } from '../services/authService.js';
import { addMessage, createTicket, updateTicket } from '../services/ticketService.js';
import { query } from './pool.js';

// Demo accounts only - fictional people, not real credentials.
export const DEMO_USERS = [
  { name: 'Alex Admin', email: 'admin@demo.test', role: 'admin', password: 'admin123' },
  { name: 'Priya Agent', email: 'priya@demo.test', role: 'agent', password: 'agent123' },
  { name: 'Sam Agent', email: 'sam@demo.test', role: 'agent', password: 'agent123' },
];

/** Inserts the demo users (idempotent). Returns them keyed by email. */
export async function seedUsers() {
  const users = {};
  for (const u of DEMO_USERS) {
    const { rows } = await query(
      `INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role
       RETURNING id, name, email, role`,
      [u.name, u.email, u.role, await hashPassword(u.password)],
    );
    users[u.email] = rows[0];
  }
  return users;
}

// Fictional sample tickets. `ageHours` backdates the ticket so the overdue and SLA
// indicators have something to show straight away.
const SAMPLE_TICKETS = [
  {
    subject: 'Cannot reset my password',
    customerName: 'Jane Doe',
    customerEmail: 'jane.doe@example.com',
    description: 'The reset link in the email says it has expired, even when I click it straight away.',
    priority: 'High',
    ageHours: 30,
  },
  {
    subject: 'Invoice shows the wrong amount',
    customerName: 'Acme Corp',
    customerEmail: 'billing@acme.example',
    description: 'Our October invoice charges for 12 seats but we only have 10 active users.',
    priority: 'Medium',
    assignee: 'priya@demo.test',
    status: 'In Progress',
    reply: 'Thanks for flagging this - I am checking your seat history with our billing team now.',
    ageHours: 3,
  },
  {
    subject: 'App crashes when uploading photos',
    customerEmail: 'marco@example.org',
    description: 'Every time I upload a photo larger than ~5 MB the mobile app closes without an error.',
    priority: 'Urgent',
    assignee: 'sam@demo.test',
    note: 'Reproduced on Android 14. Looks related to the image compression change in the last release.',
    ageHours: 50,
  },
  {
    subject: 'Feature request: dark mode',
    customerName: 'Lena Fischer',
    description: 'Would love a dark theme for the dashboard, it is hard on the eyes at night.',
    priority: 'Low',
    assignee: 'priya@demo.test',
    status: 'Waiting on Customer',
    reply: 'Great suggestion! Could you tell us which pages you use most so we can prioritise them?',
    ageHours: 96,
  },
  {
    subject: 'Order #4821 not delivered',
    customerName: 'Tom Becker',
    customerEmail: 'tom.becker@example.net',
    description: 'Tracking says delivered two days ago but nothing arrived.',
    priority: 'Urgent',
    assignee: 'sam@demo.test',
    status: 'In Progress',
    note: 'Courier claim opened, reference CL-0091. Waiting for their investigation.',
    ageHours: 6,
  },
  {
    subject: 'How do I export my data?',
    customerEmail: 'ops@example.com',
    description: 'We need a CSV export of all our projects for an internal audit.',
    priority: 'Low',
    assignee: 'priya@demo.test',
    reply: 'You can export from Settings > Data > Export CSV. Let us know if anything is missing!',
    status: 'Resolved',
    ageHours: 72,
  },
  {
    subject: 'Login page loads slowly',
    customerName: 'Chris Morgan',
    description: 'The login page takes 10+ seconds to load from our office network.',
    priority: 'Medium',
    ageHours: 1,
  },
];

/** Creates sample tickets through the service layer, but only into an empty database. */
export async function seedSampleTickets(users) {
  const { rows } = await query('SELECT count(*)::int AS n FROM tickets');
  if (rows[0].n > 0) return 0;

  const admin = users['admin@demo.test'];
  for (const sample of SAMPLE_TICKETS) {
    const assignee = sample.assignee ? users[sample.assignee] : null;
    const ticket = await createTicket(
      {
        subject: sample.subject,
        customerName: sample.customerName ?? null,
        customerEmail: sample.customerEmail ?? null,
        description: sample.description,
        status: 'Open',
        priority: sample.priority,
        assigneeId: assignee?.id ?? null,
      },
      admin,
    );
    const actor = assignee ?? admin;
    if (sample.note) await addMessage(ticket.id, { kind: 'note', body: sample.note }, actor);
    if (sample.reply) await addMessage(ticket.id, { kind: 'reply', body: sample.reply }, actor);
    if (sample.status) await updateTicket(ticket.id, { status: sample.status }, actor);

    // Shift the whole ticket back in time. Follow-up activity is spread over the
    // first hour so the history still reads in a sensible order.
    const age = `${sample.ageHours} hours`;
    await query(
      `UPDATE tickets SET
         created_at = created_at - $2::interval,
         updated_at = updated_at - $2::interval + interval '50 minutes',
         first_response_at = first_response_at - $2::interval + interval '30 minutes',
         resolved_at = resolved_at - $2::interval + interval '50 minutes'
       WHERE id = $1`,
      [ticket.id, age],
    );
    await query(
      `UPDATE ticket_messages SET created_at = created_at - $2::interval + (interval '20 minutes' * (kind = 'reply')::int + interval '10 minutes')
       WHERE ticket_id = $1`,
      [ticket.id, age],
    );
    await query(
      `UPDATE ticket_events SET created_at = created_at - $2::interval + CASE event_type
         WHEN 'created' THEN interval '0' WHEN 'assignee_changed' THEN interval '0'
         WHEN 'note_added' THEN interval '10 minutes' WHEN 'reply_added' THEN interval '30 minutes'
         ELSE interval '50 minutes' END
       WHERE ticket_id = $1`,
      [ticket.id, age],
    );
  }
  return SAMPLE_TICKETS.length;
}
