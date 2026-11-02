import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { AiError, callProvider } from './providers.js';

// Both SDKs read their base URL from these env vars, so a local server that
// never answers stands in for a hung provider.
async function withHungServer(fn) {
  const server = createServer(() => {});
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const saved = { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL, OPENAI_BASE_URL: process.env.OPENAI_BASE_URL };
  process.env.ANTHROPIC_BASE_URL = url;
  process.env.OPENAI_BASE_URL = `${url}/v1`;
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    server.closeAllConnections();
    server.close();
  }
}

for (const provider of ['anthropic', 'openai']) {
  test(`${provider}: the timeout bounds the whole call, retries included`, async () => {
    await withHungServer(async () => {
      const started = Date.now();
      await assert.rejects(
        callProvider({ provider, apiKey: 'sk-test', model: 'm', system: 's', user: 'u', schema: {}, timeoutSeconds: 1 }),
        (err) => err instanceof AiError && err.status === 504 && /within 1 seconds/.test(err.message)
      );
      // One attempt plus a retry would take at least 2s.
      assert.ok(Date.now() - started < 1800, `took ${Date.now() - started}ms`);
    });
  });
}
