// Runs the SLA escalation check once, e.g. from cron or by an administrator.
// Safe to run at any time, also while the API's own scheduler is running.
import { closePool } from '../src/db/pool.js';
import { runEscalationCheck } from '../src/services/escalationService.js';

try {
  const result = await runEscalationCheck();
  const summary = result.escalated.map((e) => `#${e.ticketId}→L${e.stage}`).join(', ');
  console.log(result.escalated.length ? `Escalated: ${summary}` : 'Nothing to escalate');
  if (result.failedStages.length) {
    console.error(`Failed stages: ${result.failedStages.join(', ')}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await closePool();
}
