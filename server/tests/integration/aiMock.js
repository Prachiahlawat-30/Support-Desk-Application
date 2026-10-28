// Fake OpenAI Chat Completions responses for tests that mock the provider's fetch call.

export const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const completion = (content, finishReason = 'stop') =>
  jsonResponse({
    choices: [
      {
        message: { role: 'assistant', content: typeof content === 'string' ? content : JSON.stringify(content), refusal: null },
        finish_reason: finishReason,
      },
    ],
  });
