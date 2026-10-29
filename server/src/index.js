import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { closePool } from './db/pool.js';
import { startEscalationScheduler } from './jobs/escalationScheduler.js';
import { attachRealtime } from './realtime/socketServer.js';

// One HTTP server for both the REST API and Socket.IO (real-time ticket notifications).
const server = http.createServer(createApp());
const io = attachRealtime(server);

server.listen(config.port, () => {
  console.log(`Support Desk API listening on http://localhost:${config.port}`);
});

const scheduler = config.escalation.schedulerEnabled
  ? startEscalationScheduler({ intervalMs: config.escalation.checkIntervalSeconds * 1000 })
  : null;

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  await new Promise((resolve) => io.close(() => resolve())); // also closes the HTTP server
  await scheduler?.stop();
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
