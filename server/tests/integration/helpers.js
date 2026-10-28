import './env.js';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { migrate } from '../../src/db/migrate.js';
import { query } from '../../src/db/pool.js';
import { seedUsers } from '../../src/db/seed.js';

export const skipReason = process.env.TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

/** Migrates the test database, empties it and recreates the demo users. */
export async function resetDatabase() {
  await migrate();
  await query('TRUNCATE ticket_events, ticket_messages, tickets, users RESTART IDENTITY CASCADE');
  return seedUsers();
}

/** Returns a supertest agent factory that sends the given user's token. */
export async function signIn(app, email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
  const auth = { Authorization: `Bearer ${res.body.data.token}` };
  return {
    user: res.body.data.user,
    auth,
    get: (url) => request(app).get(url).set(auth),
    post: (url, body) => request(app).post(url).set(auth).send(body),
    patch: (url, body) => request(app).patch(url).set(auth).send(body),
    delete: (url) => request(app).delete(url).set(auth),
  };
}

export { createApp, query };
