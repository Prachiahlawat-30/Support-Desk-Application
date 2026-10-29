import { createApp, query, resetDatabase, signIn, skipReason } from './helpers.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { after, afterEach, before, beforeEach, describe, it } from 'node:test';
import jwt from 'jsonwebtoken';
import { io as connectClient } from 'socket.io-client';
import { config } from '../../src/config.js';
import { closePool } from '../../src/db/pool.js';
import { CLIENT_EVENTS, SERVER_EVENTS } from '../../src/realtime/events.js';
import { setRealtimeServer } from '../../src/realtime/publisher.js';
import { attachRealtime } from '../../src/realtime/socketServer.js';
import { runEscalationCheck } from '../../src/services/escalationService.js';

// Socket.IO end to end: a real server on an ephemeral port and real socket.io-client
// connections. Waits use acknowledgements and event promises, never sleeps. "No event"
// is checked by ordering: after the action that must not emit, a known event is caused,
// and the first event received has to be that one (Socket.IO keeps per-socket order).

const EVENT_TIMEOUT = 8000;

describe('Real-time updates (Socket.IO)', { skip: skipReason }, () => {
  let server;
  let io;
  let url;
  let admin;
  let agent;
  let sam;
  let clients = [];

  const tokenOf = (user) => user.auth.Authorization.slice('Bearer '.length);

  /** Connects and resolves once the handshake is accepted; rejects with the handshake error. */
  function connect(token, { auth = token === undefined ? {} : { token } } = {}) {
    const socket = connectClient(url, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
    clients.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (err) => reject(err));
    });
  }

  const emitAck = (socket, event, payload) =>
    new Promise((resolve) => socket.emit(event, payload, (ack) => resolve(ack)));
  const subscribe = (socket, ticketId) => emitAck(socket, CLIENT_EVENTS.SUBSCRIBE, { ticketId });

  /** Resolves with the next `event` matching `predicate`. */
  function next(socket, event, predicate = () => true) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(event, handler);
        reject(new Error(`timed out waiting for ${event}`));
      }, EVENT_TIMEOUT);
      function handler(payload) {
        if (!predicate(payload)) return;
        clearTimeout(timer);
        socket.off(event, handler);
        resolve(payload);
      }
      socket.on(event, handler);
    });
  }

  /** Records every server event a socket receives, in order. */
  function record(socket) {
    const log = [];
    socket.onAny((event, payload) => log.push({ event, payload }));
    return log;
  }

  const newTicket = async (overrides = {}) =>
    (
      await agent
        .post('/api/tickets', {
          subject: 'Printer on fire',
          customerName: 'Jo Customer',
          customerEmail: 'jo.customer@example.com',
          description: 'Smoke everywhere',
          priority: 'Medium',
          ...overrides,
        })
        .expect(201)
    ).body.data;

  before(async () => {
    server = http.createServer(createApp());
    io = attachRealtime(server, { corsOrigin: 'http://localhost:5173' });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  beforeEach(async () => {
    await resetDatabase();
    const app = createApp();
    admin = await signIn(app, 'admin@demo.test', 'admin123');
    agent = await signIn(app, 'priya@demo.test', 'agent123');
    sam = await signIn(app, 'sam@demo.test', 'agent123');
  });

  afterEach(() => {
    clients.forEach((socket) => socket.disconnect());
    clients = [];
  });

  after(async () => {
    setRealtimeServer(null);
    await new Promise((resolve) => io.close(() => resolve()));
    await closePool();
  });

  describe('handshake authentication', () => {
    it('rejects connections without a token', async () => {
      const err = await connect(undefined).catch((e) => e);
      assert.equal(err.message, 'UNAUTHORIZED');
      assert.equal(err.data.code, 'UNAUTHORIZED');
    });

    it('rejects malformed and wrongly signed tokens without echoing them', async () => {
      for (const token of ['not-a-jwt', jwt.sign({ sub: '2' }, 'some-other-secret')]) {
        const err = await connect(token).catch((e) => e);
        assert.equal(err.data.code, 'UNAUTHORIZED');
        assert.ok(!JSON.stringify(err.data).includes(token));
      }
    });

    it('rejects expired tokens', async () => {
      const expired = jwt.sign({ sub: String(agent.user.id), role: 'agent', exp: Math.floor(Date.now() / 1000) - 60 }, config.jwtSecret);
      const err = await connect(expired).catch((e) => e);
      assert.equal(err.data.code, 'UNAUTHORIZED');
      assert.match(err.data.message, /expired/);
    });

    it('rejects tokens of accounts that no longer exist', async () => {
      await query(`DELETE FROM users WHERE email = 'sam@demo.test'`);
      const err = await connect(tokenOf(sam)).catch((e) => e);
      assert.equal(err.data.code, 'UNAUTHORIZED');
    });

    it('accepts a valid token and ignores identity claims sent by the client', async () => {
      const socket = await connect(undefined, { auth: { token: tokenOf(agent), userId: admin.user.id, role: 'admin' } });
      assert.equal(socket.connected, true);
      const [serverSocket] = await io.fetchSockets();
      assert.deepEqual(serverSocket.data.user, { id: agent.user.id, name: 'Priya Agent', role: 'agent' });
    });
  });

  describe('ticket subscriptions', () => {
    it('lets a signed-in user subscribe to an existing ticket', async () => {
      const ticket = await newTicket();
      const socket = await connect(tokenOf(agent));
      assert.deepEqual(await subscribe(socket, ticket.id), { ok: true, ticketId: ticket.id });
      assert.deepEqual(await subscribe(socket, String(ticket.id)), { ok: true, ticketId: ticket.id }, 'digit strings are accepted');
    });

    it('rejects missing, malformed and unknown ticket ids', async () => {
      const socket = await connect(tokenOf(agent));
      for (const payload of [undefined, null, {}, { ticketId: 'abc' }, { ticketId: -1 }, { ticketId: 1.5 }, { ticketId: '1; DROP' }, 'x']) {
        const ack = await emitAck(socket, CLIENT_EVENTS.SUBSCRIBE, payload);
        assert.equal(ack.ok, false);
        assert.equal(ack.error.code, 'BAD_REQUEST', JSON.stringify(payload));
      }
      const unknown = await subscribe(socket, 999999);
      assert.deepEqual(unknown.error.code, 'NOT_FOUND');
      const rooms = [...(await io.fetchSockets())[0].rooms];
      assert.ok(!rooms.some((r) => r.startsWith('ticket:')), 'no room was joined');
    });

    it('drops a connection whose account was removed after connecting', async () => {
      const ticket = await newTicket();
      const socket = await connect(tokenOf(sam));
      await query(`DELETE FROM users WHERE email = 'sam@demo.test'`);
      const disconnected = new Promise((resolve) => socket.once('disconnect', resolve));
      const ack = await subscribe(socket, ticket.id);
      assert.equal(ack.error.code, 'UNAUTHORIZED');
      await disconnected;
    });

    it('limits how often a socket may subscribe', async () => {
      const ticket = await newTicket();
      const socket = await connect(tokenOf(agent));
      const acks = [];
      for (let i = 0; i < 32; i++) acks.push(await subscribe(socket, ticket.id));
      assert.equal(acks.at(-1).error.code, 'RATE_LIMITED');
    });

    it('stops ticket events after unsubscribing', async () => {
      const ticket = await newTicket();
      const viewer = await connect(tokenOf(sam));
      await subscribe(viewer, ticket.id);
      assert.deepEqual(await emitAck(viewer, CLIENT_EVENTS.UNSUBSCRIBE, { ticketId: ticket.id }), { ok: true, ticketId: ticket.id });
      const log = record(viewer);

      // The workspace notice still arrives; the message itself must not have come before it.
      const notice = next(viewer, SERVER_EVENTS.TICKET_UPDATED, (p) => p.ticketId === ticket.id && p.reason === 'message');
      await agent.post(`/api/tickets/${ticket.id}/messages`, { kind: 'reply', body: 'Hello' }).expect(201);
      await notice;
      assert.ok(!log.some((e) => e.event === SERVER_EVENTS.MESSAGE_ADDED));
    });
  });

  describe('event delivery', () => {
    it('sends committed field changes to ticket viewers and the workspace', async () => {
      const ticket = await newTicket();
      const viewer = await connect(tokenOf(sam));
      await subscribe(viewer, ticket.id);
      const elsewhere = await connect(tokenOf(admin)); // not viewing the ticket

      const seenByViewer = next(viewer, SERVER_EVENTS.TICKET_UPDATED);
      const seenElsewhere = next(elsewhere, SERVER_EVENTS.TICKET_UPDATED);
      const res = await agent.patch(`/api/tickets/${ticket.id}`, { priority: 'Urgent', assigneeId: sam.user.id }).expect(200);

      const payload = await seenByViewer;
      assert.deepEqual(Object.keys(payload).sort(), ['actorId', 'at', 'changes', 'fields', 'reason', 'ticketId', 'updatedAt']);
      assert.equal(payload.ticketId, ticket.id);
      assert.equal(payload.reason, 'edited');
      assert.deepEqual([...payload.fields].sort(), ['assigneeId', 'priority']);
      assert.deepEqual(payload.changes, { priority: 'Urgent', assigneeId: sam.user.id, assigneeName: 'Sam Agent' });
      assert.equal(payload.actorId, agent.user.id);
      assert.equal(payload.updatedAt, res.body.data.updatedAt);
      assert.deepEqual(await seenElsewhere, payload);
    });

    it('reports resolving and reopening', async () => {
      const ticket = await newTicket();
      const viewer = await connect(tokenOf(sam));
      await subscribe(viewer, ticket.id);
      let seen = next(viewer, SERVER_EVENTS.TICKET_UPDATED);
      await agent.patch(`/api/tickets/${ticket.id}`, { status: 'Resolved' }).expect(200);
      assert.deepEqual((await seen).changes, { status: 'Resolved' });
      seen = next(viewer, SERVER_EVENTS.TICKET_UPDATED);
      await agent.patch(`/api/tickets/${ticket.id}`, { status: 'Open' }).expect(200);
      assert.deepEqual((await seen).changes, { status: 'Open' });
    });

    it('sends nothing for failed or no-op updates', async () => {
      const ticket = await newTicket();
      const viewer = await connect(tokenOf(sam));
      await subscribe(viewer, ticket.id);
      const log = record(viewer);

      await agent.patch(`/api/tickets/${ticket.id}`, { assigneeId: 999999 }).expect(400); // fails inside the transaction
      await agent.patch(`/api/tickets/${ticket.id}`, { status: 'Closed' }).expect(400); // fails validation
      await agent.patch(`/api/tickets/${ticket.id}`, { priority: 'Medium' }).expect(200); // no change
      await agent.post(`/api/tickets/${ticket.id}/messages`, { kind: 'reply', body: '' }).expect(400);

      const marker = next(viewer, SERVER_EVENTS.TICKET_UPDATED);
      await agent.patch(`/api/tickets/${ticket.id}`, { priority: 'Low' }).expect(200);
      assert.deepEqual((await marker).changes, { priority: 'Low' });
      assert.equal(log.length, 1, `only the marker event: ${JSON.stringify(log.map((e) => e.event))}`);
    });

    it('delivers a saved public reply once, with only the display fields', async () => {
      const ticket = await newTicket();
      const viewer = await connect(tokenOf(sam));
      await subscribe(viewer, ticket.id);
      await subscribe(viewer, ticket.id); // subscribing twice must not double deliveries
      const log = record(viewer);

      const seen = next(viewer, SERVER_EVENTS.MESSAGE_ADDED);
      const notice = next(viewer, SERVER_EVENTS.TICKET_UPDATED, (p) => p.reason === 'message');
      const res = await agent.post(`/api/tickets/${ticket.id}/messages`, { kind: 'reply', body: 'We are on it' }).expect(201);
      const payload = await seen;
      assert.deepEqual(payload, {
        ticketId: ticket.id,
        message: {
          id: res.body.data.id,
          kind: 'reply',
          body: 'We are on it',
          authorId: agent.user.id,
          authorName: 'Priya Agent',
          createdAt: res.body.data.createdAt,
        },
      });
      await notice;
      assert.equal(log.filter((e) => e.event === SERVER_EVENTS.MESSAGE_ADDED).length, 1);
    });

    it('delivers internal notes only to sockets allowed to read them, deciding from the saved record', async () => {
      const ticket = await newTicket();
      const allowed = await connect(tokenOf(admin));
      const restricted = await connect(tokenOf(sam));
      await subscribe(allowed, ticket.id);
      await subscribe(restricted, ticket.id);
      // Simulate a viewer without note access (no such role exists today) on the server side.
      const serverSockets = await io.fetchSockets();
      serverSockets.find((s) => s.data.user.id === sam.user.id).data.user.role = 'customer';
      const restrictedLog = record(restricted);

      const noteSeen = next(allowed, SERVER_EVENTS.MESSAGE_ADDED);
      await agent.post(`/api/tickets/${ticket.id}/messages`, { kind: 'note', body: 'Internal: refund pending' }).expect(201);
      assert.equal((await noteSeen).message.kind, 'note');

      // The allowed socket has its note, so any note for the restricted one was already sent.
      const replySeen = next(restricted, SERVER_EVENTS.MESSAGE_ADDED);
      await agent.post(`/api/tickets/${ticket.id}/messages`, { kind: 'reply', body: 'Public answer' }).expect(201);
      assert.equal((await replySeen).message.kind, 'reply');
      const delivered = restrictedLog.filter((e) => e.event === SERVER_EVENTS.MESSAGE_ADDED).map((e) => e.payload.message.kind);
      assert.deepEqual(delivered, ['reply']);
      assert.ok(!JSON.stringify(restrictedLog).includes('refund pending'));
    });

    it('announces created and deleted tickets to the workspace', async () => {
      const watcher = await connect(tokenOf(sam));
      const created = next(watcher, SERVER_EVENTS.TICKET_CREATED);
      const ticket = await newTicket();
      assert.deepEqual(Object.keys(await created).sort(), ['actorId', 'at', 'createdAt', 'ticketId']);

      const deleted = next(watcher, SERVER_EVENTS.TICKET_DELETED);
      await admin.delete(`/api/tickets/${ticket.id}`).expect(204);
      const payload = await deleted;
      assert.equal(payload.ticketId, ticket.id);
      assert.equal(payload.actorId, admin.user.id);

      // An agent's forbidden delete changes nothing and announces nothing.
      const secondCreated = next(watcher, SERVER_EVENTS.TICKET_CREATED);
      const other = await newTicket({ subject: 'Second' });
      await secondCreated; // so it is not mistaken for an event caused below
      const log = record(watcher);
      await agent.delete(`/api/tickets/${other.id}`).expect(403);
      const marker = next(watcher, SERVER_EVENTS.TICKET_UPDATED);
      await agent.patch(`/api/tickets/${other.id}`, { priority: 'High' }).expect(200);
      await marker;
      assert.deepEqual(log.map((e) => e.event), [SERVER_EVENTS.TICKET_UPDATED]);
    });

    it('reports escalations and acknowledgements', async () => {
      const ticket = await newTicket();
      await query(`UPDATE tickets SET created_at = now() - interval '5 hours' WHERE id = $1`, [ticket.id]);
      const viewer = await connect(tokenOf(sam));
      await subscribe(viewer, ticket.id);

      const escalated = next(viewer, SERVER_EVENTS.TICKET_UPDATED);
      await runEscalationCheck();
      const escalation = await escalated;
      assert.deepEqual([escalation.reason, escalation.fields], ['escalation', ['escalation']]);

      const acknowledged = next(viewer, SERVER_EVENTS.TICKET_UPDATED);
      await agent.post(`/api/tickets/${ticket.id}/escalation/acknowledge`, {}).expect(200);
      assert.equal((await acknowledged).reason, 'escalation_acknowledged');
    });

    it('never puts secrets or customer contact details in events', async () => {
      const watcher = await connect(tokenOf(sam));
      const ticket = await newTicket();
      await subscribe(watcher, ticket.id);
      const log = record(watcher);
      await agent.patch(`/api/tickets/${ticket.id}`, { customerEmail: 'new.address@example.com', customerName: 'New Name' }).expect(200);
      const notice = next(watcher, SERVER_EVENTS.TICKET_UPDATED, (p) => p.reason === 'message');
      await agent.post(`/api/tickets/${ticket.id}/messages`, { kind: 'reply', body: 'Thanks' }).expect(201);
      await notice;

      const text = JSON.stringify(log);
      for (const secret of ['password', 'hash', 'token', tokenOf(agent), 'example.com', 'New Name', 'Jo Customer']) {
        assert.ok(!text.includes(secret), `events must not contain ${secret}`);
      }
      const edit = log.find((e) => e.payload.reason === 'edited').payload;
      assert.deepEqual([...edit.fields].sort(), ['customerEmail', 'customerName']);
      assert.deepEqual(edit.changes, {}, 'changed customer fields are named, not sent');
    });

    it('keeps the REST API working with no socket server attached', async () => {
      setRealtimeServer(null);
      try {
        const ticket = await newTicket();
        await agent.patch(`/api/tickets/${ticket.id}`, { status: 'In Progress' }).expect(200);
        await agent.post(`/api/tickets/${ticket.id}/messages`, { kind: 'note', body: 'Still works' }).expect(201);
      } finally {
        setRealtimeServer(io);
      }
    });
  });
});
