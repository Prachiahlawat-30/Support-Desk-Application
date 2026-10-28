import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { unauthorized } from '../utils/httpError.js';
import { toUser } from './mappers.js';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/** Hashes a password as `scrypt$<salt>$<hash>` (hex). */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, hashHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return timingSafeEqual(expected, actual);
}

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

/** Returns the user id from a valid token, or throws 401. */
export function verifyToken(token) {
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return Number(payload.sub);
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}

export async function login(email, password) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
  const row = rows[0];
  // Same error for unknown email and wrong password, so accounts can't be probed.
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw unauthorized('Invalid email or password');
  }
  const user = toUser(row);
  return { token: signToken(user), user };
}
