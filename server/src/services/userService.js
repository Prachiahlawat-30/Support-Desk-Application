import { query } from '../db/pool.js';
import { toUser } from './mappers.js';

export async function findUserById(id, db = { query }) {
  const { rows } = await db.query('SELECT id, name, email, role FROM users WHERE id = $1', [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** Every user can be assigned tickets, admins included. */
export async function listAgents() {
  const { rows } = await query('SELECT id, name, email, role FROM users ORDER BY name');
  return rows.map(toUser);
}
