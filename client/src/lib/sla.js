// First-response SLA display helpers. The server computes every SLA value (see
// server/src/domain/rules.js); this file only keeps a running countdown current between
// page loads. The thresholds mirror server/src/domain/constants.js, and the server test
// suite checks that urgencyForRemaining agrees with the SQL at every boundary, so keep
// this file free of JSX and browser-only code.

export const SLA_APPROACHING_MINUTES = 60;
export const SLA_CRITICAL_MINUTES = 15;

const COUNTDOWN_URGENCIES = new Set(['on_track', 'approaching', 'critical', 'breached']);

/** Urgency of a running countdown with `seconds` left (zero or less means breached). */
export function urgencyForRemaining(seconds) {
  if (seconds <= 0) return 'breached';
  if (seconds <= SLA_CRITICAL_MINUTES * 60) return 'critical';
  if (seconds <= SLA_APPROACHING_MINUTES * 60) return 'approaching';
  return 'on_track';
}

// When each SLA object arrived, so the countdown uses elapsed time on this device rather
// than its clock, which may differ from the server's.
const receivedAt = new WeakMap();

/**
 * The SLA as of `now`. While a countdown runs, the time since the data arrived is
 * subtracted and the urgency re-derived; finished states (responded, not applicable)
 * are returned unchanged. Returns null when no SLA data is available.
 */
export function liveSla(sla, now = Date.now()) {
  if (!sla || typeof sla !== 'object') return null;
  if (!COUNTDOWN_URGENCIES.has(sla.urgency) || !Number.isFinite(sla.remainingSeconds)) return sla;
  if (!receivedAt.has(sla)) receivedAt.set(sla, now);
  const remainingSeconds = sla.remainingSeconds - Math.floor((now - receivedAt.get(sla)) / 1000);
  const urgency = urgencyForRemaining(remainingSeconds);
  return { ...sla, remainingSeconds, urgency, state: urgency === 'critical' ? 'approaching' : urgency };
}

/** 125 -> "2h 5m", 45 -> "45m", 3000 -> "2d 2h". */
export function formatMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

const spoken = (text) =>
  text
    .replace(/(\d+)d/g, '$1 days')
    .replace(/(\d+)h/g, '$1 hours')
    .replace(/(\d+)m\b/g, '$1 minutes')
    .replace(/\b1 (day|hour|minute)s\b/g, '1 $1');

/**
 * Short label plus a full sentence for screen readers and tooltips.
 * Remaining time is rounded up ("1m left" until the deadline); time since a breach is
 * rounded down.
 */
export function describeSla(sla) {
  if (!sla) return { label: '—', description: 'First-response SLA information is unavailable.' };
  const { urgency, remainingSeconds } = sla;
  if (urgency === 'breached') {
    const minutesAgo = Math.floor(-remainingSeconds / 60);
    const ago = minutesAgo < 1 ? 'just now' : `${formatMinutes(minutesAgo)} ago`;
    return { label: `SLA breached · ${ago}`, description: `First-response SLA breached ${spoken(ago)}. No public reply yet.` };
  }
  if (urgency === 'on_track' || urgency === 'approaching' || urgency === 'critical') {
    const left = formatMinutes(Math.ceil(remainingSeconds / 60));
    const level = { on_track: 'on track', approaching: 'deadline approaching', critical: 'deadline critical' }[urgency];
    return { label: `${left} left`, description: `First-response SLA ${level}: ${spoken(left)} left for a public reply.` };
  }
  if (urgency === 'responded_on_time') {
    return { label: 'Responded on time', description: 'The first public reply met the response-time target.' };
  }
  if (urgency === 'responded_late') {
    return { label: 'First response late', description: 'The first public reply was sent after the response-time target.' };
  }
  if (urgency === 'not_applicable') {
    return { label: 'Not applicable', description: 'Resolved before any public reply, so no response countdown applies.' };
  }
  return { label: '—', description: 'First-response SLA information is unavailable.' };
}
