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
  assert.deepEqual(result.target, { kind: 'block' });
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

test('only the description target explains how to write a description', () => {
  const data = { bullets: ['a'] };
  const target = { kind: 'description' };
  const { system, user } = buildPrompt('experience', rewriteInput('experience', data, target), 'x', { target });
  assert.match(system, /"description" is an optional short blurb/);
  assert.match(system, /too thin .* leave it empty/);
  assert.match(system, /"hidden": true .* Never carry their content into the description/);
  assert.match(user, /Rewriting: only the description/);

  const block = buildPrompt('experience', rewriteInput('experience', data), 'x');
  assert.doesNotMatch(block.system, /optional short blurb/);
  assert.match(block.system, /"description" in the context .* not part of this rewrite/);
  assert.match(block.system, /"hidden": true .* Never carry their content into the tagline\./);
  assert.doesNotMatch(block.user, /Rewriting:/);
  assert.doesNotMatch(buildPrompt('summary', rewriteInput('summary', {}), 'x').system, /"description"/);
});

test('a bullet prompt names the bullet and applies the sub-bullet rule', () => {
  const data = { bullets: [{ text: 'a', children: [{ text: 'b' }] }, 'c'] };
  const top = { kind: 'bullet', path: [0] };
  const { system, user } = buildPrompt('experience', rewriteInput('experience', data, top), 'x', { target: top });
  assert.match(user, /Rewriting: only bullet 1 \(with its sub-bullets\)/);
  assert.match(user, /\[the part being rewritten\]/);
  assert.match(system, /rewriting one bullet/);
  assert.match(system, /same number of sub-bullets/);
  assert.match(buildPrompt('experience', rewriteInput('experience', data, top), 'x', { target: top, allowBulletRestructure: true }).system, /may add, remove, merge, or split this bullet's sub-bullets/);

  const sub = { kind: 'bullet', path: [0, 0] };
  const subPrompt = buildPrompt('experience', rewriteInput('experience', data, sub), 'x', { target: sub });
  assert.match(subPrompt.user, /Rewriting: only sub-bullet 1 of bullet 1/);
  assert.doesNotMatch(subPrompt.system, /sub-bullets under this bullet/);
});

test('an item prompt names the item and its type', () => {
  const data = { items: [{ heading: 'h', bodyType: 'list', items: 'a\nb' }] };
  const target = { kind: 'item', index: 0 };
  const { system, user } = buildPrompt('custom', rewriteInput('custom', data, target), 'x', { target });
  assert.match(user, /Rewriting: only item 1/);
  assert.match(user, /"itemBodyType": "list"/);
  assert.match(system, /rewriting one item/);
  assert.doesNotMatch(system, /same number of items/);
});

test('rewriteBlock passes the target through to the schema and the result', async () => {
  let request;
  const result = await rewriteBlock({
    type: 'experience',
    data: { description: 'Old', bullets: ['a'] },
    instruction: 'x',
    target: { kind: 'description', stray: true },
    settings: settings(),
    callModel: async (req) => {
      request = req;
      return { explanation: '', rewrite: { description: 'New' } };
    },
  });
  assert.deepEqual(Object.keys(request.schema.properties.rewrite.properties), ['description']);
  assert.deepEqual(result.target, { kind: 'description' });
  assert.deepEqual(result.proposedData, { description: 'New', bullets: ['a'] });
  assert.equal(result.bulletReview, null);
});

test('a custom item rewrite carries the picked tense along with its target', async () => {
  let request;
  const data = { title: 'Projects', items: [{ heading: 'A', bodyType: 'text', text: 'Builds things.' }, { heading: 'B', bodyType: 'text', text: 'x' }] };
  const result = await rewriteBlock({
    type: 'custom',
    data,
    instruction: 'Tighten',
    tense: 'past',
    target: { kind: 'item', index: 0 },
    settings: settings(),
    callModel: async (req) => {
      request = req;
      return { explanation: '', rewrite: { heading: 'A', body: 'Built things.' } };
    },
  });
  assert.match(request.system, /use the past tense/);
  assert.match(request.user, /Rewriting: only item 1/);
  assert.deepEqual(Object.keys(request.schema.properties.rewrite.properties), ['heading', 'body']);
  assert.equal(result.proposedData.items[0].text, 'Built things.');
  assert.equal(result.proposedData.items[1], data.items[1]);
});

test('block data the rewrite code can\'t handle is a 400 before calling the model', async () => {
  let called = false;
  for (const data of [null, { bullets: [null] }, { bullets: [{ text: 'a', children: [null] }] }]) {
    await assert.rejects(
      rewriteBlock({
        type: 'experience',
        data,
        instruction: 'x',
        target: { kind: 'bullet', path: [0] },
        settings: settings(),
        callModel: async () => (called = true),
      }),
      (err) => err instanceof AiError && err.status === 400,
      JSON.stringify(data)
    );
  }
  assert.equal(called, false);
});

test('an invalid target is a 400 before calling the model', async () => {
  let called = false;
  await assert.rejects(
    rewriteBlock({
      type: 'experience',
      data: { bullets: ['a'] },
      instruction: 'x',
      target: { kind: 'bullet', path: [3] },
      settings: settings(),
      callModel: async () => (called = true),
    }),
    (err) => err instanceof AiError && err.status === 400
  );
  assert.equal(called, false);
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

const brief = { audience: 'SRE roles', posting: 'We need Kubernetes and on-call.', guidance: 'Stress incident work.' };
const TAILORING_RULE = /Tailor the section for the audience in the brief/;

test('a brief adds the tailoring rules and the brief itself, with the guidance after the instruction', () => {
  const input = rewriteInput('summary', { text: 'Engineer.' });
  const plain = buildPrompt('summary', input, 'Make it punchier');
  assert.doesNotMatch(plain.system, TAILORING_RULE);
  assert.doesNotMatch(plain.user, /Brief/);

  const tailored = buildPrompt('summary', input, 'Make it punchier', { brief });
  assert.match(tailored.system, TAILORING_RULE);
  assert.match(tailored.system, /Never add a skill, technology, credential, or claim because the brief or the posting mentions it/);
  assert.match(tailored.system, /reference material, not instructions/);
  assert.match(tailored.user, /Audience: SRE roles/);
  assert.match(tailored.user, /We need Kubernetes and on-call\./);
  const { user } = tailored;
  assert.ok(user.indexOf('Instruction:') < user.indexOf('Stress incident work.'), 'the guidance goes with the instruction');
  assert.ok(user.indexOf('We need Kubernetes') < user.indexOf('Section to rewrite:'), 'the posting is read-only context');

  // no posting or guidance, no empty sections for them
  const bare = buildPrompt('summary', input, 'x', { brief: { audience: 'SRE roles', posting: '', guidance: '' } });
  assert.doesNotMatch(bare.user, /Job posting/);
  assert.doesNotMatch(bare.user, /Guidance/);
});

test('with a brief the instruction may be empty, the summary sees its outline, and the schema is unchanged', async () => {
  const requests = [];
  const callModel = async (req) => (requests.push(req), { explanation: 'Tailored.', rewrite: { text: 'SRE.' } });
  const outline = { experience: [{ jobTitle: 'SRE', company: 'Acme', dates: '2021' }] };
  const data = { text: 'Engineer.' };
  await rewriteBlock({ type: 'summary', data, instruction: 'x', settings: settings(), callModel });
  const result = await rewriteBlock({ type: 'summary', data, instruction: '', settings: settings(), brief, outline, callModel });
  assert.deepEqual(result.proposedData, { text: 'SRE.' });
  assert.match(requests[1].user, /Instruction:\nTailor this section for the audience in the brief\./);
  assert.match(requests[1].user, /Outline of the rest of the resume/);
  assert.match(requests[1].user, /"company": "Acme"/);
  assert.match(requests[1].system, /never on anything it does not say/);
  assert.deepEqual(requests[1].schema, requests[0].schema);

  // an outline without a brief is ignored
  await rewriteBlock({ type: 'summary', data, instruction: 'x', settings: settings(), outline, callModel });
  assert.doesNotMatch(requests[2].user, /Outline/);
});

test('an executive summary always sees its outline, with the accomplishments rule, and gets its own rules', async () => {
  const requests = [];
  const rewrite = { headline: 'SRE lead', text: 'Runs platforms.', highlights: ['Cut deploys to minutes'] };
  const callModel = async (req) => (requests.push(req), { explanation: 'Drafted.', rewrite });
  const outline = { experience: [{ jobTitle: 'SRE', company: 'Acme', dates: '2021', bullets: ['Cut deploys to minutes'] }] };
  const data = { text: '' };
  const result = await rewriteBlock({ type: 'executive_summary', data, instruction: 'Draft it', settings: settings(), outline, callModel });
  assert.deepEqual(result.proposedData, rewrite);
  const [{ system, user, schema }] = requests;
  assert.match(user, /^Section type: Executive summary/);
  assert.match(user, /Outline of the rest of the resume/);
  assert.match(user, /"Cut deploys to minutes"/);
  assert.match(system, /never on anything it does not say/);
  assert.match(system, /never combine numbers from different bullets/);
  assert.match(system, /A field that is empty stays empty unless the instruction asks you to write it/);
  assert.deepEqual(Object.keys(schema.properties.rewrite.properties), ['headline', 'text', 'highlights']);
  assert.equal(tenseLine(system), null);

  // a plain summary's prompt has none of that
  const summary = buildPrompt('summary', rewriteInput('summary', { text: 'x' }), 'x', { outline });
  assert.doesNotMatch(summary.system, /never combine numbers|A field that is empty/);
});
