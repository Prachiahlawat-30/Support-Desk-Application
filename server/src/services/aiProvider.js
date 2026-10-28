import { config } from '../config.js';
import { HttpError } from '../utils/httpError.js';

// The only module that talks to the AI provider (OpenAI Chat Completions with
// Structured Outputs). It makes one attempt per call, with a timeout, and turns every
// provider failure into an HttpError whose message is safe to show in the browser.
// Provider details are logged as status/code only, never with ticket content.

const MAX_OUTPUT_TOKENS = 2_000;

const aiError = (status, code, message) => new HttpError(status, message, { code });

export function isAiConfigured() {
  return Boolean(config.ai.apiKey);
}

function providerHttpError(status) {
  if (status === 401 || status === 403) {
    return aiError(503, 'AI_UNAVAILABLE', 'The AI provider rejected the server credentials. Ask an administrator to check OPENAI_API_KEY.');
  }
  if (status === 404) {
    return aiError(503, 'AI_UNAVAILABLE', 'The configured AI model is not available. Ask an administrator to check OPENAI_MODEL.');
  }
  if (status === 429) {
    return aiError(503, 'AI_RATE_LIMITED', 'The AI provider is busy or its usage limit was reached. Please try again in a minute.');
  }
  return aiError(502, 'AI_PROVIDER_ERROR', 'The AI provider could not complete the analysis. Please try again.');
}

/**
 * Sends a system and user message and returns the model's JSON answer, parsed but
 * not yet validated. `schema` is a JSON Schema the provider enforces on the output.
 */
export async function requestStructuredJson({ system, user, schemaName, schema }) {
  if (!isAiConfigured()) {
    throw aiError(503, 'AI_NOT_CONFIGURED', 'The AI Support Copilot is not configured. Set OPENAI_API_KEY in server/.env and restart the API.');
  }

  let res;
  try {
    res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.apiKey}` },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
        max_completion_tokens: MAX_OUTPUT_TOKENS,
      }),
      signal: AbortSignal.timeout(config.ai.timeoutMs),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      console.warn(`[ai] request timed out after ${config.ai.timeoutMs}ms`);
      throw aiError(504, 'AI_TIMEOUT', 'The AI took too long to respond. Please try again.');
    }
    console.warn('[ai] request failed:', err?.cause?.code || err?.name || 'unknown error');
    throw aiError(502, 'AI_PROVIDER_ERROR', 'Could not reach the AI provider. Please try again.');
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    console.warn(`[ai] provider returned ${res.status}`, payload?.error?.code || payload?.error?.type || '');
    throw providerHttpError(res.status);
  }

  const choice = payload?.choices?.[0];
  const message = choice?.message;
  if (message?.refusal) {
    console.warn('[ai] model refused the request');
    throw aiError(502, 'AI_INVALID_RESPONSE', 'The AI declined to analyze this ticket.');
  }
  if (choice?.finish_reason === 'length' || typeof message?.content !== 'string') {
    console.warn('[ai] incomplete response, finish_reason:', choice?.finish_reason ?? 'none');
    throw aiError(502, 'AI_INVALID_RESPONSE', 'The AI returned an incomplete answer. Please try again.');
  }
  try {
    return JSON.parse(message.content);
  } catch {
    console.warn('[ai] response was not valid JSON');
    throw aiError(502, 'AI_INVALID_RESPONSE', 'The AI returned an answer in an unexpected format. Please try again.');
  }
}
