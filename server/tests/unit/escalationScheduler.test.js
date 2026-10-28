import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { startEscalationScheduler } from '../../src/jobs/escalationScheduler.js';

// The scheduler only decides *when* to run; it is tested with a fake check.

function fakeLogger() {
  const lines = [];
  const record = (level) => (...args) => lines.push([level, args.join(' ')]);
  return { lines, log: record('log'), warn: record('warn'), error: record('error') };
}

function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

describe('escalation scheduler', () => {
  it('runs once at start, never overlaps, and stops cleanly', async () => {
    const gate = deferred();
    let calls = 0;
    const run = async () => {
      calls++;
      await gate.promise;
      return { escalated: [{ ticketId: 7, stage: 1 }], failedStages: [] };
    };
    const logger = fakeLogger();
    const scheduler = startEscalationScheduler({ intervalMs: 60 * 60_000, run, logger });

    // The first check is still running: runNow returns that same check instead of starting another.
    const inProgress = scheduler.runNow();
    assert.equal(scheduler.runNow(), inProgress);
    assert.equal(calls, 1);

    gate.resolve();
    await scheduler.stop();
    assert.equal(calls, 1);
    assert.deepEqual(logger.lines, [['log', '[escalation] escalated 1 ticket stage(s): #7→L1']]);
    assert.equal(await scheduler.runNow(), null, 'no runs after stop');
    assert.equal(calls, 1);
  });

  it('refuses a second scheduler while one is running', async () => {
    const run = async () => ({ escalated: [], failedStages: [] });
    const logger = fakeLogger();
    const first = startEscalationScheduler({ intervalMs: 60 * 60_000, run, logger });
    const second = startEscalationScheduler({ intervalMs: 60 * 60_000, run, logger });
    assert.equal(second, first);
    assert.match(logger.lines.at(-1)[1], /already running/);
    await first.stop();
    const third = startEscalationScheduler({ intervalMs: 60 * 60_000, run, logger });
    assert.notEqual(third, first, 'can start again after stop');
    await third.stop();
  });

  it('logs a failed check and keeps going', async () => {
    let calls = 0;
    const run = async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
      return { escalated: [], failedStages: [] };
    };
    const logger = fakeLogger();
    const scheduler = startEscalationScheduler({ intervalMs: 20, run, logger });
    await new Promise((r) => setTimeout(r, 120));
    await scheduler.stop();
    assert.ok(calls >= 2, 'later runs still happen');
    assert.deepEqual(logger.lines[0], ['error', '[escalation] check failed: ECONNRESET connection reset']);
  });
});
