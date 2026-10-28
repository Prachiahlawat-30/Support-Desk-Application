import { runEscalationCheck } from '../services/escalationService.js';

// Runs the SLA escalation check on a timer inside the API process. Only src/index.js starts
// it (never createApp, so tests and scripts don't). Duplicates are prevented by the database,
// so a restart, an overlapping run or a second server instance cannot escalate twice.

let active = null;

/**
 * Starts the periodic check and runs it once right away. Returns `{ stop, runNow }`.
 * `stop` clears the timer and waits for a check in progress to finish.
 */
export function startEscalationScheduler({ intervalMs, run = runEscalationCheck, logger = console }) {
  if (active) {
    logger.warn('[escalation] scheduler already running; not starting another');
    return active;
  }

  let current = null; // the check in progress, if any
  let stopped = false;

  // Returns the check in progress instead of starting another, so runs never overlap.
  function runNow() {
    if (stopped) return Promise.resolve(null);
    if (current) return current;
    current = (async () => {
      try {
        const result = await run();
        if (result.escalated.length) {
          // Ticket ids and stages only: no ticket content in the logs.
          const summary = result.escalated.map((e) => `#${e.ticketId}→L${e.stage}`).join(', ');
          logger.log(`[escalation] escalated ${result.escalated.length} ticket stage(s): ${summary}`);
        }
        return result;
      } catch (err) {
        logger.error('[escalation] check failed:', err?.code ?? '', err?.message ?? err);
        return null;
      } finally {
        current = null;
      }
    })();
    return current;
  }

  const timer = setInterval(runNow, intervalMs);
  timer.unref?.(); // never keeps the process alive on its own
  runNow();

  active = {
    runNow,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await current;
      active = null;
    },
  };
  return active;
}
