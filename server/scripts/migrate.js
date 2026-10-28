import { migrate } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';

try {
  const applied = await migrate({ log: console.log });
  console.log(applied.length ? `Done: ${applied.length} migration(s) applied` : 'Database is up to date');
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
