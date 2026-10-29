import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it, mock } from 'node:test';
import { createRealtimeClient } from '../../../client/src/lib/realtime.js';
import * as clientEvents from '../../../client/src/lib/realtimeEvents.js';
import { appendMessage, applyTicketChanges, debounce } from '../../../client/src/lib/ticketUpdates.js';
import * as serverEvents from '../../src/realtime/events.js';

// The browser's real-time layer (client/src/lib), tested with a fake socket: the same code
// the React hooks use, without a browser.

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.active = true;
    this.sent = [];
    this.acks = new Map(); // event -> ack to reply with
  }
  /** What the client sends to the server. */
  emit(event, payload, ack) {
    this.sent.push({ event, payload });
    if (typeof ack === 'function') ack(this.acks.get(event) ?? { ok: true, ticketId: payload?.ticketId });
    return true;
  }
  /** Something arriving from the server (events, connection lifecycle). */
  serverSend(event, payload) {
    super.emit(event, payload);
  }
  connectNow() {
    this.connected = true;
    super.emit('connect');
  }
  drop(reason = 'transport close') {
    this.connected = false;
    super.emit('disconnect', reason);
  }
  disconnect() {
    this.connected = false;
    this.active = false;
  }
}

function setup(options = {}) {
  const sockets = [];
  const authErrors = [];
  const client = createRealtimeClient({
    connect: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    onAuthError: () => authErrors.push(true),
    logger: { error: () => {} },
    ...options,
  });
  return { client, sockets, authErrors, socket: () => sockets.at(-1) };
}

const subscribes = (socket) => socket.sent.filter((s) => s.event === 'ticket:subscribe').map((s) => s.payload.ticketId);

describe('real-time client manager', () => {
  it('uses one connection per session and reports real connection state only', () => {
    const { client, sockets } = setup();
    const statuses = [];
    client.onStatus((s) => statuses.push(s));
    assert.equal(client.getStatus(), 'offline');
    client.start();
    client.start(); // remounts do not open a second connection
    assert.equal(sockets.length, 1);
    assert.equal(client.getStatus(), 'connecting', 'not "connected" before the socket connects');
    sockets[0].connectNow();
    sockets[0].drop();
    sockets[0].connectNow();
    client.stop();
    assert.deepEqual(statuses, ['connecting', 'connected', 'reconnecting', 'connected', 'offline']);
  });

  it('subscribes once per ticket however many components view it, and unsubscribes with the last', () => {
    const { client, socket } = setup();
    client.start();
    socket().connectNow();
    const releaseA = client.subscribeTicket(5);
    const releaseB = client.subscribeTicket(5);
    assert.deepEqual(subscribes(socket()), [5]);
    releaseA();
    releaseA(); // releasing twice is harmless
    assert.ok(!socket().sent.some((s) => s.event === 'ticket:unsubscribe'));
    releaseB();
    assert.deepEqual(socket().sent.at(-1), { event: 'ticket:unsubscribe', payload: { ticketId: 5 } });
    assert.deepEqual(client.subscribedTickets(), []);
  });

  it('subscribes on connect when asked before the socket was ready', () => {
    const { client, socket } = setup();
    client.start();
    client.subscribeTicket(9);
    assert.deepEqual(subscribes(socket()), []);
    socket().connectNow();
    assert.deepEqual(subscribes(socket()), [9]);
  });

  it('resubscribes to the open ticket and asks pages to resync after a reconnect', () => {
    const { client, socket } = setup();
    let resyncs = 0;
    client.onResync(() => resyncs++);
    client.start();
    socket().connectNow();
    client.subscribeTicket(12);
    assert.equal(resyncs, 0, 'no resync on the first connect');
    socket().drop();
    assert.equal(client.getStatus(), 'reconnecting');
    socket().connectNow();
    assert.deepEqual(subscribes(socket()), [12, 12]);
    assert.equal(resyncs, 1);
  });

  it('reports a refused subscription to the component that asked', () => {
    const { client, socket } = setup();
    client.start();
    socket().acks.set('ticket:subscribe', { ok: false, error: { code: 'NOT_FOUND', message: 'Ticket #3 was not found.' } });
    socket().connectNow();
    const errors = [];
    client.subscribeTicket(3, (e) => errors.push(e.code));
    assert.deepEqual(errors, ['NOT_FOUND']);
  });

  it('delivers each event once per handler and stops after the handler is removed', () => {
    const { client, socket } = setup();
    client.start();
    socket().connectNow();
    const received = [];
    const handler = (p) => received.push(p.message.id);
    const off = client.on('ticket:message_added', handler);
    client.on('ticket:message_added', handler); // the same function again: still one listener
    assert.equal(client.listenerCount('ticket:message_added'), 1);
    socket().serverSend('ticket:message_added', { ticketId: 1, message: { id: 7 } });
    off();
    socket().serverSend('ticket:message_added', { ticketId: 1, message: { id: 8 } });
    assert.deepEqual(received, [7]);
    assert.equal(client.listenerCount('ticket:message_added'), 0);
    assert.throws(() => client.on('ticket:anything', () => {}), /Unknown real-time event/);
  });

  it('keeps delivering to other handlers when one throws', () => {
    const { client, socket } = setup();
    client.start();
    socket().connectNow();
    const received = [];
    client.on('ticket:updated', () => {
      throw new Error('boom');
    });
    client.on('ticket:updated', (p) => received.push(p.ticketId));
    socket().serverSend('ticket:updated', { ticketId: 4 });
    assert.deepEqual(received, [4]);
  });

  it('stops retrying and checks the session when the server rejects the token', () => {
    const { client, socket, authErrors } = setup();
    client.start();
    socket().active = false; // Socket.IO does not retry a middleware rejection
    socket().serverSend('connect_error', Object.assign(new Error('UNAUTHORIZED'), { data: { code: 'UNAUTHORIZED' } }));
    assert.equal(client.getStatus(), 'offline');
    assert.equal(authErrors.length, 1);
  });

  it('treats a server-side disconnect (e.g. token expiry) as offline and checks the session', () => {
    const { client, socket, authErrors } = setup();
    client.start();
    socket().connectNow();
    socket().drop('io server disconnect');
    assert.equal(client.getStatus(), 'offline');
    assert.equal(authErrors.length, 1);
  });

  it('shows network failures as reconnecting while Socket.IO retries', () => {
    const { client, socket, authErrors } = setup();
    client.start();
    socket().serverSend('connect_error', new Error('xhr poll error'));
    assert.equal(client.getStatus(), 'reconnecting');
    assert.equal(authErrors.length, 0);
  });

  it('removes all socket listeners on stop', () => {
    const { client, socket } = setup();
    client.start();
    const s = socket();
    s.connectNow();
    client.stop();
    assert.equal(s.listenerCount('ticket:updated'), 0);
    assert.equal(s.listenerCount('connect'), 0);
    assert.equal(s.active, false);
  });
});

describe('ticket update helpers', () => {
  const ticket = {
    id: 5,
    status: 'Open',
    priority: 'Medium',
    assigneeId: null,
    assigneeName: null,
    subject: 'Old',
    customerEmail: 'keep@example.com',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [{ id: 1, kind: 'reply', body: 'a', createdAt: '2026-01-01T00:00:00.000Z' }],
  };

  it('applies only known live fields of the matching ticket', () => {
    const next = applyTicketChanges(ticket, {
      ticketId: 5,
      changes: { priority: 'Urgent', assigneeId: 3, assigneeName: 'Sam Agent', customerEmail: 'evil@example.com' },
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    assert.deepEqual([next.priority, next.assigneeId, next.assigneeName, next.updatedAt], ['Urgent', 3, 'Sam Agent', '2026-01-02T00:00:00.000Z']);
    assert.equal(next.customerEmail, 'keep@example.com');
    assert.equal(applyTicketChanges(ticket, { ticketId: 6, changes: { priority: 'Low' } }), ticket, 'other tickets are ignored');
    assert.equal(applyTicketChanges(ticket, { ticketId: 5, changes: {} }), ticket, 'nothing changed, same object');
    assert.equal(applyTicketChanges(null, { ticketId: 5 }), null);
  });

  it('appends a message once, in order, even if the event arrives twice', () => {
    const payload = { ticketId: 5, message: { id: 2, kind: 'note', body: 'b', createdAt: '2026-01-01T01:00:00.000Z' } };
    const once = appendMessage(ticket, payload);
    const twice = appendMessage(once, payload);
    assert.deepEqual(twice.messages.map((m) => m.id), [1, 2]);
    assert.equal(twice, once);
    const earlier = appendMessage(once, { ticketId: 5, message: { id: 0, kind: 'reply', body: 'z', createdAt: '2025-12-31T00:00:00.000Z' } });
    assert.deepEqual(earlier.messages.map((m) => m.id), [0, 1, 2]);
    assert.equal(appendMessage(ticket, { ticketId: 9, message: { id: 3 } }), ticket);
  });

  it('debounces bursts into one call', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      let calls = 0;
      const run = debounce(() => calls++, 500);
      run();
      run();
      mock.timers.tick(499);
      run();
      mock.timers.tick(500);
      assert.equal(calls, 1);
      run();
      run.cancel();
      mock.timers.tick(1000);
      assert.equal(calls, 1);
    } finally {
      mock.timers.reset();
    }
  });
});

describe('event contract', () => {
  it('uses the same event names on client and server', () => {
    assert.deepEqual(clientEvents.CLIENT_EVENTS, serverEvents.CLIENT_EVENTS);
    assert.deepEqual(clientEvents.SERVER_EVENTS, serverEvents.SERVER_EVENTS);
  });

  it('validates subscription ids strictly', () => {
    const parse = serverEvents.parseTicketIdPayload;
    assert.equal(parse({ ticketId: 12 }), 12);
    assert.equal(parse({ ticketId: '12' }), 12);
    for (const bad of [undefined, null, 'x', {}, { ticketId: 0 }, { ticketId: -2 }, { ticketId: 1.5 }, { ticketId: '1e3' }, { ticketId: 2 ** 31 }]) {
      assert.equal(parse(bad), null, JSON.stringify(bad));
    }
  });
});
