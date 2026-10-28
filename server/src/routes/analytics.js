import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { buildCsvReport } from '../services/analyticsExport.js';
import { getAgentAnalytics, getOverview } from '../services/analyticsService.js';
import { validationError } from '../utils/httpError.js';
import { parseAnalyticsQuery } from '../validation/analyticsQuery.js';

// Support analytics. Mounted behind requireAuth; every route also requires an admin, so
// agents cannot reach it through the ordinary ticket permissions.
export const analyticsRouter = Router();
analyticsRouter.use(requireRole('admin'));

function range(query, options) {
  const { value, errors } = parseAnalyticsQuery(query, new Date(), options);
  if (errors) throw validationError(errors);
  return value;
}

analyticsRouter.get('/overview', async (req, res) => {
  res.json({ data: await getOverview(range(req.query)) });
});

analyticsRouter.get('/agents', async (req, res) => {
  res.json({ data: await getAgentAnalytics(range(req.query)) });
});

analyticsRouter.get('/export', async (req, res) => {
  const { report, ...rest } = range(req.query, { requireReport: true });
  const { filename, csv } = await buildCsvReport(rest, report);
  res
    .status(200)
    .type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${filename}"`)
    .set('Cache-Control', 'no-store')
    .send(csv);
});
