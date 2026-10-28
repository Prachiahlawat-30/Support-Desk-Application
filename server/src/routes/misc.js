import { Router } from 'express';
import { getDashboard } from '../services/dashboardService.js';
import { listAgents } from '../services/userService.js';

export const agentsRouter = Router();

agentsRouter.get('/', async (_req, res) => {
  res.json({ data: await listAgents() });
});

export const dashboardRouter = Router();

dashboardRouter.get('/', async (_req, res) => {
  res.json({ data: await getDashboard() });
});
