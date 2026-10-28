import { closePool } from '../src/db/pool.js';
import { DEMO_USERS, seedSampleTickets, seedUsers } from '../src/db/seed.js';

try {
  const users = await seedUsers();
  console.log(`Demo users ready: ${DEMO_USERS.map((u) => `${u.email} / ${u.password}`).join(', ')}`);
  const created = await seedSampleTickets(users);
  console.log(created ? `Created ${created} sample tickets` : 'Tickets already exist - skipped sample tickets');
} catch (err) {
  console.error('Seeding failed:', err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
