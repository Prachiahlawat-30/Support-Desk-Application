import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeSla, formatMinutes, liveSla, urgencyForRemaining } from '../../../client/src/lib/sla.js';
import { SLA_APPROACHING_MINUTES, SLA_CRITICAL_MINUTES } from '../../src/domain/constants.js';

// The client's countdown helpers (client/src/lib/sla.js). The parity of their thresholds
// with the SQL rule is checked in tests/integration/sla.test.js.

const countdown = (remainingSeconds) => ({
  state: 'on_track',
  urgency: urgencyForRemaining(remainingSeconds),
  deadline: '2026-03-01T12:00:00.000Z',
  remainingSeconds,
  targetHours: 4,
});

describe('client SLA helpers', () => {
  it('uses the same thresholds as the server', async () => {
    const client = await import('../../../client/src/lib/sla.js');
    assert.equal(client.SLA_APPROACHING_MINUTES, SLA_APPROACHING_MINUTES);
    assert.equal(client.SLA_CRITICAL_MINUTES, SLA_CRITICAL_MINUTES);
  });

  it('counts down from the time the data arrived and changes urgency at the thresholds', () => {
    const sla = countdown(3660); // 61 minutes left on arrival
    const t0 = 1_000_000;
    assert.equal(liveSla(sla, t0).urgency, 'on_track');
    assert.equal(liveSla(sla, t0 + 60_000).urgency, 'approaching'); // exactly 60m left
    assert.equal(liveSla(sla, t0 + 46 * 60_000).urgency, 'critical'); // exactly 15m left
    const atDeadline = liveSla(sla, t0 + 61 * 60_000);
    assert.equal(atDeadline.urgency, 'breached');
    assert.equal(atDeadline.state, 'breached');
    assert.equal(liveSla(sla, t0 + 50 * 60_000).state, 'approaching');
  });

  it('leaves finished states unchanged and tolerates missing data', () => {
    const responded = { state: 'responded_on_time', urgency: 'responded_on_time', remainingSeconds: null };
    assert.equal(liveSla(responded, Date.now() + 10_000_000), responded);
    assert.equal(liveSla(null), null);
    assert.equal(liveSla(undefined), null);
    assert.deepEqual(liveSla({ urgency: 'on_track', remainingSeconds: null }), { urgency: 'on_track', remainingSeconds: null });
  });

  it('formats durations compactly', () => {
    assert.equal(formatMinutes(204), '3h 24m');
    assert.equal(formatMinutes(45), '45m');
    assert.equal(formatMinutes(60), '1h 0m');
    assert.equal(formatMinutes(3000), '2d 2h');
    assert.equal(formatMinutes(-5), '0m');
  });

  it('labels each state, rounding time left up and time since a breach down', () => {
    assert.equal(describeSla(countdown(204 * 60)).label, '3h 24m left');
    assert.equal(describeSla(countdown(45 * 60)).label, '45m left');
    assert.equal(describeSla(countdown(11 * 60 + 1)).label, '12m left');
    assert.equal(describeSla(countdown(1)).label, '1m left');
    assert.equal(describeSla(countdown(-(130 * 60 + 59))).label, 'SLA breached · 2h 10m ago');
    assert.equal(describeSla(countdown(-30)).label, 'SLA breached · just now');
    assert.equal(describeSla({ urgency: 'responded_on_time' }).label, 'Responded on time');
    assert.equal(describeSla({ urgency: 'responded_late' }).label, 'First response late');
    assert.equal(describeSla({ urgency: 'not_applicable' }).label, 'Not applicable');
    assert.equal(describeSla(null).label, '—');
    assert.equal(describeSla({ urgency: 'something_new' }).label, '—');
  });

  it('gives screen readers a full sentence that names the urgency', () => {
    assert.equal(
      describeSla(countdown(12 * 60)).description,
      'First-response SLA deadline critical: 12 minutes left for a public reply.',
    );
    assert.equal(describeSla(countdown(61 * 60)).description, 'First-response SLA on track: 1 hour 1 minute left for a public reply.');
    assert.match(describeSla(countdown(-3600)).description, /breached 1 hour 0 minutes ago/);
  });
});
