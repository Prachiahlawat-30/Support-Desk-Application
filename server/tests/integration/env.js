// Imported first by integration tests: switches config to TEST_DATABASE_URL before
// any app module reads it, and refuses to run against the development database.
import 'dotenv/config';

process.env.NODE_ENV = 'test';
// Pin the SLA so assertions don't depend on a developer's local .env.
process.env.SLA_FIRST_RESPONSE_HOURS = '4';
process.env.SLA_ESCALATION_LEVEL2_HOURS = '2';
// Tests never call a real AI provider: the key is fake, the URL points at a closed local
// port, and the copilot tests replace fetch with a mock.
process.env.OPENAI_API_KEY = 'test-key-not-real';
process.env.OPENAI_MODEL = 'test-model';
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:9/v1';
process.env.OPENAI_TIMEOUT_MS = '20000';

if (process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL - the tests wipe the test database.');
}
