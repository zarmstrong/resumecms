import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// A provider failure translated into something safe and useful to show in
// the editor. `status` is the HTTP status the route responds with.
export class AiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_OUTPUT_TOKENS = 16000;

// Models that accept the server-side `fallbacks: "default"` parameter, which
// re-runs a request a safety classifier declined on a recommended fallback
// model instead of failing outright. Other models (including any older one
// typed into settings) are called without it — they'd reject the parameter.
const ANTHROPIC_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

// `timeoutSeconds` bounds the whole call: the SDK's own timeout covers one
// attempt, and the abort signal stops a retry from running past the limit.
function requestLimits(timeoutSeconds) {
  const ms = timeoutSeconds * 1000;
  return { clientOptions: { timeout: ms, maxRetries: 1 }, requestOptions: { signal: AbortSignal.timeout(ms) } };
}

const timeoutError = (timeoutSeconds) =>
  new AiError(504, `The AI didn't respond within ${timeoutSeconds} seconds. Try again, or raise the timeout in Account Settings.`);

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiError(502, 'The AI returned a response that could not be read. Try again.');
  }
}

async function callAnthropic({ apiKey, model, system, user, schema, timeoutSeconds }) {
  const { clientOptions, requestOptions } = requestLimits(timeoutSeconds);
  const client = new Anthropic({ apiKey, ...clientOptions });
  const params = {
    model,
    max_tokens: MAX_OUTPUT_TOKENS,
    system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  };
  let response;
  try {
    response = ANTHROPIC_FALLBACK_MODELS.has(model)
      ? await client.beta.messages.create(
          { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
          requestOptions
        )
      : await client.messages.create(params, requestOptions);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError(400, 'Anthropic rejected the API key. Check it in Account Settings.');
    if (err instanceof Anthropic.NotFoundError) throw new AiError(400, `Anthropic doesn't recognize the model "${model}".`);
    if (err instanceof Anthropic.RateLimitError) throw new AiError(429, 'Anthropic rate limit reached. Wait a moment and try again.');
    if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIUserAbortError) {
      throw timeoutError(timeoutSeconds);
    }
    if (err instanceof Anthropic.APIError) throw new AiError(502, `Anthropic API error${err.status ? ` (${err.status})` : ''}: ${err.message}`);
    throw err;
  }
  if (response.stop_reason === 'refusal') throw new AiError(422, 'The AI declined to rewrite this section.');
  if (response.stop_reason === 'max_tokens') throw new AiError(502, 'The AI response was cut off. Try a shorter section or instruction.');
  const text = response.content.find((block) => block.type === 'text')?.text;
  if (!text) throw new AiError(502, 'The AI returned an empty response. Try again.');
  return parseJson(text);
}

async function callOpenAI({ apiKey, model, system, user, schema, timeoutSeconds }) {
  const { clientOptions, requestOptions } = requestLimits(timeoutSeconds);
  const client = new OpenAI({ apiKey, ...clientOptions });
  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model,
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'resume_rewrite', strict: true, schema } },
      },
      requestOptions
    );
  } catch (err) {
    if (err instanceof OpenAI.AuthenticationError) throw new AiError(400, 'OpenAI rejected the API key. Check it in Account Settings.');
    if (err instanceof OpenAI.NotFoundError) throw new AiError(400, `OpenAI doesn't recognize the model "${model}".`);
    if (err instanceof OpenAI.RateLimitError) throw new AiError(429, 'OpenAI rate limit reached. Wait a moment and try again.');
    if (err instanceof OpenAI.APIConnectionTimeoutError || err instanceof OpenAI.APIUserAbortError) {
      throw timeoutError(timeoutSeconds);
    }
    if (err instanceof OpenAI.APIError) throw new AiError(502, `OpenAI API error${err.status ? ` (${err.status})` : ''}: ${err.message}`);
    throw err;
  }
  const choice = completion.choices?.[0];
  if (choice?.message?.refusal) throw new AiError(422, 'The AI declined to rewrite this section.');
  if (choice?.finish_reason === 'length') throw new AiError(502, 'The AI response was cut off. Try a shorter section or instruction.');
  if (!choice?.message?.content) throw new AiError(502, 'The AI returned an empty response. Try again.');
  return parseJson(choice.message.content);
}

const PROVIDER_CALLS = { anthropic: callAnthropic, openai: callOpenAI };

// Sends one structured-output request to the configured provider and
// returns the parsed JSON object.
export function callProvider({ provider, ...request }) {
  if (!Object.hasOwn(PROVIDER_CALLS, provider)) throw new AiError(400, `Unknown AI provider: ${provider}`);
  return PROVIDER_CALLS[provider](request);
}
