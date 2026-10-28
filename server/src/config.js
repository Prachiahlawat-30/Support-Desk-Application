import 'dotenv/config';

const env = process.env.NODE_ENV || 'development';

function positiveNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const jwtSecret = process.env.JWT_SECRET || (env === 'production' ? null : 'dev-only-insecure-secret');
if (!jwtSecret) {
  throw new Error('JWT_SECRET must be set in production');
}

export const config = {
  env,
  port: positiveNumber(process.env.PORT, 4000),
  // Tests run against their own database so they can safely wipe it.
  databaseUrl: env === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL,
  jwtSecret,
  jwtExpiresIn: '12h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  slaFirstResponseHours: positiveNumber(process.env.SLA_FIRST_RESPONSE_HOURS, 4),
  // SLA escalation (services/escalationService.js). Stage 1 is reached when the first-response
  // SLA is breached; stage 2 when there is still no public reply this many hours later.
  escalation: {
    level2Hours: positiveNumber(process.env.SLA_ESCALATION_LEVEL2_HOURS, 2),
    checkIntervalSeconds: positiveNumber(process.env.ESCALATION_CHECK_INTERVAL_SECONDS, 60),
    // The API process runs the periodic check unless this is "false".
    schedulerEnabled: process.env.ESCALATION_CHECK_ENABLED !== 'false',
  },
  // AI Support Copilot. Without an API key the copilot endpoint answers 503 and the
  // rest of the app works normally. The key never leaves the server.
  ai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    timeoutMs: positiveNumber(process.env.OPENAI_TIMEOUT_MS, 20_000),
  },
};
