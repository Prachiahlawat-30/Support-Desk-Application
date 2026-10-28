import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { runEscalationCheck } from '../services/escalationService.js';

// Administrative operations. Mounted behind requireAuth; every route also requires an admin.
export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

// Runs the SLA escalation check now (it also runs on a timer). Takes no input: what is
// due is decided entirely on the server, and re-running is safe.
adminRouter.post('/escalations/run', async (_req, res) => {
  res.json({ data: await runEscalationCheck() });
});
