import cors from 'cors';
import express from 'express';
import { config } from './config.js';
import { query } from './db/pool.js';
import { requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { adminRouter } from './routes/admin.js';
import { analyticsRouter } from './routes/analytics.js';
import { authRouter } from './routes/auth.js';
import { agentsRouter, dashboardRouter } from './routes/misc.js';
import { ticketsRouter } from './routes/tickets.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', async (_req, res) => {
    await query('SELECT 1');
    res.json({ data: { status: 'ok' } });
  });

  app.use('/api/auth', authRouter);

  // Everything below requires a signed-in user.
  app.use('/api', requireAuth);
  app.use('/api/agents', agentsRouter);
  app.use('/api/tickets', ticketsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/analytics', analyticsRouter);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
