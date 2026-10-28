import { createApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { startEscalationScheduler } from './jobs/escalationScheduler.js';

const server = createApp().listen(config.port, () => {
  console.log(`Support Desk API listening on http://localhost:${config.port}`);
});

const scheduler = config.escalation.schedulerEnabled
  ? startEscalationScheduler({ intervalMs: config.escalation.checkIntervalSeconds * 1000 })
  : null;

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close();
  await scheduler?.stop();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
