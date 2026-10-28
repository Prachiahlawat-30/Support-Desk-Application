// Creates the app database (and the test database, if configured) when missing.
// Connects to the server's default `postgres` database to do so.
import 'dotenv/config';
import pg from 'pg';

async function ensureDatabase(url) {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  if (!dbName) throw new Error(`No database name in ${target.origin}`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount) {
      console.log(`Database "${dbName}" already exists`);
    } else {
      await client.query(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
      console.log(`Created database "${dbName}"`);
    }
  } finally {
    await client.end();
  }
}

const urls = [process.env.DATABASE_URL, process.env.TEST_DATABASE_URL].filter(Boolean);
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy server/.env.example to server/.env first.');
  process.exit(1);
}

try {
  for (const url of urls) await ensureDatabase(url);
} catch (err) {
  console.error('Could not create database:', err.message);
  process.exit(1);
}
