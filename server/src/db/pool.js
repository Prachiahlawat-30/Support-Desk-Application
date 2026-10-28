import pg from 'pg';
import { config } from '../config.js';

let pool;

export function getPool() {
  if (!pool) {
    if (!config.databaseUrl) {
      const name = config.env === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL';
      throw new Error(`${name} is not set. Copy server/.env.example to server/.env and configure it.`);
    }
    pool = new pg.Pool({ connectionString: config.databaseUrl });
  }
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}

/** Runs `fn(client)` inside a transaction; rolls back if it throws. */
export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
