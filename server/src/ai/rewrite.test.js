import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiSettings } from './aiSettings.js';
import { AiError } from './providers.js';
import { TENSE_RULES, buildPrompt, rewriteBlock } from './rewrite.js';
import { rewriteInput } from './rewritableFields.js';
import { AI_TENSES, PICKED_TENSES } from './tense.js';

// The tense whose rule the system prompt carries, or null for none.
const tenseLine = (system) => {
  const found = Object.keys(TENSE_RULES).filter((tense) => system.includes(`- ${TENSE_RULES[tense]}`));
  assert.ok(found.length <= 1, `more than one tense rule: ${found}`);
  return found[0] ?? null;
};

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

test('the tense rule follows the resolved tense and is absent by default', () => {
  const input = rewriteInput('summary', { text: 'x' });
  const past = buildPrompt('summary', input, 'x', { tense: 'past' }).system;
  const present = buildPrompt('summary', input, 'x', { tense: 'present' }).system;
  assert.equal(tenseLine(past), 'past');
  assert.match(past, /"Led a team of five", not "Lead a team of five"/);
  assert.equal(tenseLine(present), 'present');
  assert.match(present, /drop the implied "I" \("Lead a team of five", not "Leads a team of five"/);
  assert.match(present, /a full sentence keeps the original's subject/);
  // Only past tense could turn "who the person is" into something they were.
  assert.match(past, /Statements of who the person is .* stay as they are/);
  assert.doesNotMatch(present, /Statements of who the person is/);
  assert.equal(tenseLine(buildPrompt('summary', input, 'x').system), null);
  assert.equal(tenseLine(buildPrompt('summary', input, 'x', { tense: null }).system), null);
  for (const system of [past, present]) {
    // An instruction that names a tense wins, and text the instruction
    // doesn't concern keeps its tense, so the rule can't conflict with
    // "only make the changes the instruction asks for".
    assert.match(system, /unless the instruction asks for a different tense/);
    assert.match(system, /Leave text the instruction does not concern as it is, whatever its tense/);
  }
});

test('every tense a request can resolve to has prompt wording', () => {
  // resolveTense only returns 'past', 'present', or null; a new option that
  // reaches it needs a TENSE_RULES entry, or buildPrompt silently drops it.
  const resolvable = new Set([...Object.keys(AI_TENSES), ...Object.keys(PICKED_TENSES)]);
  resolvable.delete('auto');
  resolvable.delete('byRole'); // resolves to past or present
  for (const tense of resolvable) assert.ok(Object.hasOwn(TENSE_RULES, tense), tense);
});

test('buildPrompt ignores a tense that is not one of its own rules', () => {
  const input = rewriteInput('summary', { text: 'x' });
  for (const tense of ['toString', 'constructor', '__proto__', 'future']) {
    assert.equal(tenseLine(buildPrompt('summary', input, 'x', { tense }).system), null);
    assert.doesNotMatch(buildPrompt('summary', input, 'x', { tense }).system, /function|\[object/);
  }
});

test('rewriteBlock resolves the tense setting and a picked tense into the system prompt', async () => {
  const systemFor = async (tense, type, data, rewrite, picked) => {
    let system;
    const callModel = async (req) => ((system = req.system), { explanation: '', rewrite });
    await rewriteBlock({ type, data, instruction: 'i', settings: settings({ tense }), tense: picked, callModel });
    return system;
  };
  const summary = (tense) => systemFor(tense, 'summary', { text: 'x' }, { text: 'y' });
  const experience = (tense, endDate) =>
    systemFor(tense, 'experience', { endDate, bullets: ['a'] }, { tagline: '', description: '', bullets: [{ text: 'b', children: [] }] });
  const custom = (tense, picked) =>
    systemFor(tense, 'custom', { title: 't', items: [] }, { title: 't', items: [] }, picked);

  assert.equal(tenseLine(await summary('past')), null);
  assert.equal(tenseLine(await experience('past', 'Current')), 'past');
  assert.equal(tenseLine(await experience('byRole', 'Current')), 'present');
  assert.equal(tenseLine(await experience('byRole', '2021')), 'past');
  assert.equal(tenseLine(await experience('byRole', '')), null);
  assert.equal(tenseLine(await custom('past')), 'past');
  assert.equal(tenseLine(await custom('past', 'present')), 'present');
  assert.equal(tenseLine(await custom('present', 'auto')), null);
});

test('rewriteBlock rejects a picked tense that is unknown or for a block that has no choice', async () => {
  let called = false;
  const callModel = async () => ((called = true), { explanation: '', rewrite: { text: 'y' } });
  const reject = (type, data, tense) =>
    assert.rejects(
      rewriteBlock({ type, data, instruction: 'i', settings: settings(), tense, callModel }),
      (err) => err instanceof AiError && err.status === 400
    );
  await reject('custom', { items: [] }, 'future');
  await reject('custom', { items: [] }, 'byRole');
  await reject('custom', { items: [] }, null);
  await reject('summary', { text: 'x' }, 'past');
  await reject('experience', { bullets: [] }, 'past');
  assert.equal(called, false);
});
