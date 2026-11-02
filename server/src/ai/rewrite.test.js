import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiSettings } from './aiSettings.js';
import { AiError } from './providers.js';
import { buildPrompt, rewriteBlock } from './rewrite.js';
import { rewriteInput } from './rewritableFields.js';

const settings = (overrides = {}) =>
  normalizeAiSettings({ enabled: true, provider: 'openai', apiKeys: { openai: 'sk-test' }, ...overrides });

test('passes the configured provider, key, and model to the model call', async () => {
  let request;
  const result = await rewriteBlock({
    type: 'summary',
    data: { text: 'I do things.' },
    instruction: 'Make it punchier',
    settings: settings({ models: { openai: 'test-model' } }),
    callModel: async (req) => {
      request = req;
      return { explanation: 'Tightened it.', rewrite: { text: 'I ship things.' } };
    },
  });
  assert.equal(request.provider, 'openai');
  assert.equal(request.apiKey, 'sk-test');
  assert.equal(request.model, 'test-model');
  assert.equal(request.timeoutSeconds, 60);
  assert.match(request.user, /Make it punchier/);
  assert.deepEqual(result.proposedData, { text: 'I ship things.' });
  assert.equal(result.explanation, 'Tightened it.');
  assert.equal(result.bulletReview, null);
});

test('an unmergeable model response becomes a 502 AiError', async () => {
  await assert.rejects(
    rewriteBlock({
      type: 'summary',
      data: { text: 'x' },
      instruction: 'y',
      settings: settings(),
      callModel: async () => ({ explanation: '', rewrite: {} }),
    }),
    (err) => err instanceof AiError && err.status === 502
  );
});

test('non-rewritable types are rejected before calling the model', async () => {
  let called = false;
  await assert.rejects(
    rewriteBlock({ type: 'education', data: {}, instruction: 'y', settings: settings(), callModel: async () => (called = true) }),
    (err) => err instanceof AiError && err.status === 400
  );
  assert.equal(called, false);
});

test('the bullet rule in the prompt follows the restructure setting', () => {
  const input = rewriteInput('experience', { bullets: ['a'] });
  assert.match(buildPrompt('experience', input, 'x').system, /exactly the same number of bullets/);
  assert.match(buildPrompt('experience', input, 'x', { allowBulletRestructure: true }).system, /may add, remove, merge/);
  assert.match(buildPrompt('experience', input, 'x', { allowBulletRestructure: true }).system, /Never merge or move content from a bullet marked "hidden"/);
});

test('the experience prompt explains the optional description', () => {
  const input = rewriteInput('experience', { bullets: ['a'] });
  const { system } = buildPrompt('experience', input, 'x');
  assert.match(system, /"description" is an optional short blurb/);
  assert.match(system, /too thin .* leave it empty/);
  assert.match(system, /"hidden": true .* Never carry their content into the tagline or description/);
  assert.doesNotMatch(buildPrompt('summary', rewriteInput('summary', {}), 'x').system, /"description"/);
});

test('read-only context is sent separately from the editable section', () => {
  const input = rewriteInput('experience', { company: 'Acme', bullets: [] });
  const { user } = buildPrompt('experience', input, 'x');
  assert.match(user, /Context \(read-only/);
  assert.match(user, /"company": "Acme"/);
});
