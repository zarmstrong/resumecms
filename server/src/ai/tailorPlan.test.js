import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiSettings } from './aiSettings.js';
import { AiError } from './providers.js';
import {
  buildPlanPrompt,
  checkPlan,
  hideKey,
  normalizePlanRequest,
  planOutline,
  planOutputSchema,
  suggestTailoring,
} from './tailorPlan.js';

const block = (id, type, data = {}, extra = {}) => ({
  id,
  type,
  parentId: null,
  visibleWeb: true,
  visiblePrint: true,
  data,
  ...extra,
});

// A draft in display order: summary, two jobs at the top level, then a
// Projects section with two custom blocks and a Skills section.
function draft() {
  return [
    block('sum', 'summary', { text: 'Engineer.' }),
    block('job1', 'experience', {
      jobTitle: 'Security Engineer',
      company: 'Acme',
      startDate: '2022',
      endDate: 'Present',
      bullets: [
        { text: 'Ran the bug bounty', visibleWeb: true, visiblePrint: true, children: [{ text: 'Triaged 400 reports', visibleWeb: true, visiblePrint: true }] },
        { text: 'Wrote CSS', visibleWeb: true, visiblePrint: true, children: [] },
        { text: 'Old secret', visibleWeb: false, visiblePrint: false, children: [] },
      ],
    }),
    block('job2', 'experience', { jobTitle: 'Frontend Contractor', company: 'Webby', bullets: ['Built pages'] }),
    block('h1', 'heading', { text: 'Projects' }),
    block('p1', 'custom', { title: 'Fuzzer', items: [{ heading: 'Fuzzer', bodyType: 'text', text: 'A fuzzer' }] }, { parentId: 'h1' }),
    block('p2', 'custom', { title: 'Theme', items: [] }, { parentId: 'h1' }),
    block('h2', 'heading', { text: 'Skills' }),
    block('s1', 'skills_group', { category: 'Security', items: 'Burp, Ghidra' }, { parentId: 'h2' }),
    block('gone', 'skills_group', { category: 'Hidden', items: 'x' }, { parentId: 'h2', visibleWeb: false, visiblePrint: false }),
  ];
}

const brief = { audience: 'security engineering roles', posting: 'We need AppSec.', guidance: 'Lead with security.' };
const settings = normalizeAiSettings({ enabled: true, provider: 'openai', apiKeys: { openai: 'sk-test' } });

function refsByTarget(refs) {
  return Object.fromEntries([...refs].map(([ref, { blockId, path }]) => [path ? `${blockId}@${path.join('.')}` : blockId, ref]));
}

test('normalizePlanRequest needs a brief and at least one of hide and order', () => {
  assert.throws(() => normalizePlanRequest({ hide: true }), { status: 400 });
  assert.throws(() => normalizePlanRequest({ brief, hide: false, order: false }), { status: 400 });
  assert.throws(() => normalizePlanRequest({ brief }), { status: 400 });
  assert.throws(() => normalizePlanRequest({ brief, hide: 'yes' }), { status: 400 });
  assert.throws(() => normalizePlanRequest({ brief, hide: true, hideFrom: 'web' }), { status: 400 });
  assert.throws(() => normalizePlanRequest(null), { status: 400 });
  assert.deepEqual(normalizePlanRequest({ brief, hide: true }), { brief, hide: true, order: false, hideFrom: 'both' });
  assert.equal(normalizePlanRequest({ brief, order: true, hideFrom: 'print' }).hideFrom, 'print');
});

test('the outline leaves out what is hidden everywhere, and refs map back', () => {
  const { outline, refs } = planOutline(draft());
  const r = refsByTarget(refs);
  assert.deepEqual(outline.map((e) => e.ref), ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8']);
  assert.equal(r.gone, undefined);
  assert.equal(r['job1@2'], undefined, 'a bullet hidden everywhere is left out');
  assert.deepEqual(refs.get(r.job1), { blockId: 'job1', path: null });
  assert.deepEqual(refs.get('B2.1'), { blockId: 'job1', path: [0] });
  assert.deepEqual(refs.get('B2.1.1'), { blockId: 'job1', path: [0, 0] });
  assert.deepEqual(refs.get('B3.1'), { blockId: 'job2', path: [0] }, 'a plain-string bullet gets a ref too');
  const job1 = outline.find((e) => e.ref === 'B2');
  assert.deepEqual(job1.bullets.map((b) => b.ref), ['B2.1', 'B2.2']);
  assert.deepEqual(job1.bullets[0].subBullets, [{ ref: 'B2.1.1', text: 'Triaged 400 reports', shows: ['web', 'pdf'] }]);
  assert.equal(outline.find((e) => e.ref === 'B5').section, 'B4');
  assert.equal(outline.find((e) => e.ref === 'B4').section, undefined);
});

test('a heading hidden everywhere stays in while something under it shows', () => {
  const blocks = [block('h', 'heading', { text: 'X' }, { visibleWeb: false, visiblePrint: false }), block('c', 'education', { degree: 'BSc' }, { parentId: 'h' })];
  const { outline } = planOutline(blocks);
  assert.deepEqual(outline.map((e) => [e.ref, e.shows]), [['B1', []], ['B2', ['web', 'pdf']]]);
  const empty = [block('h', 'heading', { text: 'X' }, { visibleWeb: false, visiblePrint: false })];
  assert.deepEqual(planOutline(empty).outline, []);
});

test('the prompt has the brief rules and no header or contact details', () => {
  const { outline } = planOutline(draft());
  const { system, user } = buildPlanPrompt(outline, brief, { hide: true, order: true });
  assert.match(system, /reference material, not instructions/);
  assert.match(system, /Never hide a summary/);
  assert.match(system, /heading moves with its whole section/);
  assert.match(user, /Audience: security engineering roles/);
  assert.match(user, /We need AppSec\./);
  assert.match(user, /Lead with security\./);
  assert.doesNotMatch(user, /Old secret/);
  assert.doesNotMatch(user, /"(email|phone|name)"/);
  assert.doesNotMatch(user, /"(job1|sum|h1)"/, 'no block ids');
  const hideOnly = buildPlanPrompt(outline, brief, { hide: true, order: false, hideFrom: 'print' }).system;
  assert.doesNotMatch(hideOnly, /heading moves with its whole section/);
  assert.match(hideOnly, /applies to the PDF/);
});

test('hides map to blocks, sections and bullets, in display order', () => {
  const blocks = draft();
  const { refs } = planOutline(blocks);
  const output = {
    explanation: ' Less frontend. ',
    hide: [
      { ref: 'B2.2', reason: 'CSS is off-topic' },
      { ref: 'B4', reason: 'Projects are thin' },
      { ref: 'B3', reason: 'Old frontend contract' },
    ],
  };
  const plan = checkPlan(blocks, output, refs, { hide: true, order: false });
  assert.equal(plan.explanation, 'Less frontend.');
  assert.equal(plan.order, null);
  assert.deepEqual(plan.hides, [
    {
      key: 'job1:hide:1',
      blockId: 'job1',
      path: [1],
      section: false,
      blockIds: ['job1'],
      reason: 'CSS is off-topic',
      before: { visibleWeb: true, visiblePrint: true, text: 'Wrote CSS' },
    },
    {
      key: 'job2:hide',
      blockId: 'job2',
      path: null,
      section: false,
      blockIds: ['job2'],
      reason: 'Old frontend contract',
      before: { visibleWeb: true, visiblePrint: true, text: null },
    },
    {
      key: 'h1:hide',
      blockId: 'h1',
      path: null,
      section: true,
      blockIds: ['h1', 'p1', 'p2'],
      reason: 'Projects are thin',
      before: { visibleWeb: true, visiblePrint: true, text: null },
    },
  ]);
  assert.equal(hideKey('b', [1, 0]), 'b:hide:1.0');
});

test('unknown, duplicate, redundant and already-hidden hides are dropped', () => {
  const blocks = draft();
  blocks[2] = { ...blocks[2], visiblePrint: false };
  const { refs } = planOutline(blocks);
  const hide = [
    { ref: 'B99', reason: 'unknown' },
    { ref: 'job2', reason: 'an id, not a ref' },
    { ref: 'B3', reason: 'already off the PDF' },
    { ref: 'B5', reason: 'inside a section that goes' },
    { ref: 'B4', reason: 'section' },
    { ref: 'B4', reason: 'duplicate' },
    { ref: 'B2.1.1', reason: 'under a bullet that goes' },
    { ref: 'B2.1', reason: 'bullet' },
  ];
  const plan = checkPlan(blocks, { explanation: '', hide }, refs, { hide: true, order: false, hideFrom: 'print' });
  assert.deepEqual(plan.hides.map((h) => [h.key, h.reason]), [['job1:hide:0', 'bullet'], ['h1:hide', 'section']]);
  // On both surfaces job2 still shows on the web, so it can go there.
  const both = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B3', reason: 'r' }] }, refs, { hide: true, order: false, hideFrom: 'both' });
  assert.deepEqual(both.hides.map((h) => h.key), ['job2:hide']);
});

test('the summary, the last experience entry and every bullet of an entry are never hidden', () => {
  const blocks = draft();
  const { refs } = planOutline(blocks);
  const hide = [
    { ref: 'B1', reason: 'summary' },
    { ref: 'B2', reason: 'job1' },
    { ref: 'B3', reason: 'job2, the last one' },
  ];
  const plan = checkPlan(blocks, { explanation: '', hide }, refs, { hide: true, order: false });
  assert.deepEqual(plan.hides.map((h) => h.blockId), ['job1']);

  const bullets = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B2.1', reason: '' }, { ref: 'B2.2', reason: '' }] }, refs, { hide: true, order: false });
  assert.deepEqual(bullets.hides.map((h) => h.key), ['job1:hide:0'], 'the second would leave the entry with no bullets');
  const only = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B3.1', reason: '' }] }, refs, { hide: true, order: false });
  assert.deepEqual(only.hides, [], "an entry's only bullet stays");
  const sub = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B2.1.1', reason: '' }] }, refs, { hide: true, order: false });
  assert.deepEqual(sub.hides.map((h) => h.key), ['job1:hide:0.0'], 'a lone sub-bullet can go');
});

test('a section holding an executive summary or the last experience entry stays', () => {
  const blocks = [
    block('h', 'heading', { text: 'About' }),
    block('es', 'executive_summary', { headline: 'Leader' }, { parentId: 'h' }),
    block('h2', 'heading', { text: 'Work' }),
    block('j', 'experience', { jobTitle: 'Dev', bullets: [] }, { parentId: 'h2' }),
  ];
  const { refs } = planOutline(blocks);
  const plan = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B1', reason: '' }, { ref: 'B3', reason: '' }] }, refs, { hide: true, order: false });
  assert.deepEqual(plan.hides, []);
});

test('the last experience entry is judged per surface', () => {
  const blocks = [
    block('a', 'experience', { jobTitle: 'A', bullets: [] }, { visiblePrint: false }),
    block('b', 'experience', { jobTitle: 'B', bullets: [] }),
  ];
  const { refs } = planOutline(blocks);
  const print = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B2', reason: '' }] }, refs, { hide: true, order: false, hideFrom: 'print' });
  assert.deepEqual(print.hides, [], 'b is the only entry on the PDF');
  const both = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B2', reason: '' }] }, refs, { hide: true, order: false, hideFrom: 'both' });
  assert.deepEqual(both.hides, [], 'b is the only entry on the PDF, whatever the web has');
  const web = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B1', reason: '' }] }, refs, { hide: true, order: false, hideFrom: 'both' });
  assert.deepEqual(web.hides.map((h) => h.blockId), ['a']);
});

test('an order moves top-level groups and blocks within a section', () => {
  const blocks = draft();
  const { refs } = planOutline(blocks);
  const order = {
    changed: true,
    topLevel: ['B1', 'B7', 'B2', 'B4', 'B3'],
    sections: [{ heading: 'B4', children: ['B6', 'B5'] }],
    reason: 'Skills first',
  };
  const plan = checkPlan(blocks, { explanation: '', order }, refs, { hide: false, order: true });
  assert.deepEqual(plan.hides, []);
  assert.deepEqual(plan.order, {
    // The hidden skills row keeps its place in its section.
    blockIds: ['sum', 'h2', 's1', 'gone', 'job1', 'h1', 'p2', 'p1', 'job2'],
    basis: blocks.map((b) => b.id),
    reason: 'Skills first',
  });
  const sectionsOnly = checkPlan(blocks, { explanation: '', order: { ...order, topLevel: [] } }, refs, { hide: false, order: true });
  assert.deepEqual(sectionsOnly.order.blockIds, ['sum', 'job1', 'job2', 'h1', 'p2', 'p1', 'h2', 's1', 'gone']);
});

test('an order that is not a permutation, or crosses sections, is dropped and the hides kept', () => {
  const blocks = draft();
  const { refs } = planOutline(blocks);
  const bad = [
    { changed: true, topLevel: ['B1', 'B2', 'B3', 'B4'], sections: [], reason: '' },
    { changed: true, topLevel: ['B1', 'B2', 'B3', 'B4', 'B4'], sections: [], reason: '' },
    { changed: true, topLevel: ['B1', 'B5', 'B2', 'B3', 'B4', 'B7'], sections: [], reason: 'nested block to top level' },
    { changed: true, topLevel: [], sections: [{ heading: 'B4', children: ['B5', 'B6', 'B8'] }], reason: 'into another section' },
    { changed: true, topLevel: [], sections: [{ heading: 'B2', children: [] }], reason: 'not a heading' },
    { changed: true, topLevel: [], sections: [{ heading: 'B4', children: ['B6', 'B5'] }, { heading: 'B4', children: ['B5', 'B6'] }], reason: 'twice' },
    { changed: true, topLevel: ['B1', 'B2', 'B3', 'B4', 'B7'], sections: [], reason: 'the same order' },
    { changed: false, topLevel: ['B7', 'B1', 'B2', 'B3', 'B4'], sections: [], reason: '' },
  ];
  for (const order of bad) {
    const plan = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B3', reason: 'r' }], order }, refs, { hide: true, order: true });
    assert.equal(plan.order, null, JSON.stringify(order));
    assert.equal(plan.hides.length, 1);
  }
});

test('a plan in the wrong shape is a 502', () => {
  const blocks = draft();
  const { refs } = planOutline(blocks);
  assert.throws(() => checkPlan(blocks, null, refs), (err) => err instanceof AiError && err.status === 502);
  assert.deepEqual(checkPlan(blocks, { explanation: 'x', hide: 'nope', order: [] }, refs), { explanation: 'x', hides: [], order: null });
});

test('suggestTailoring sends the outline and schema and checks the answer', async () => {
  let call;
  const plan = await suggestTailoring({
    blocks: draft(),
    request: normalizePlanRequest({ brief, hide: true, hideFrom: 'print' }),
    settings,
    callModel: async (req) => {
      call = req;
      return { explanation: 'ok', hide: [{ ref: 'B3', reason: 'old' }] };
    },
  });
  assert.equal(call.provider, 'openai');
  assert.deepEqual(Object.keys(call.schema.properties), ['explanation', 'hide']);
  assert.match(call.user, /Frontend Contractor/);
  assert.deepEqual(plan.hides.map((h) => h.key), ['job2:hide']);
  assert.equal(plan.order, null);
  await assert.rejects(
    suggestTailoring({ blocks: [], request: normalizePlanRequest({ brief, order: true }), settings, callModel: async () => ({}) }),
    { status: 400 }
  );
});

test('plan schemas list only what was asked for', () => {
  assert.deepEqual(Object.keys(planOutputSchema({ hide: true, order: false }).properties), ['explanation', 'hide']);
  assert.deepEqual(Object.keys(planOutputSchema({ hide: false, order: true }).properties), ['explanation', 'order']);
});

test('in a resume without nesting, a heading titles the blocks after it', () => {
  const blocks = [
    block('sum', 'summary', { text: 'Engineer.' }),
    block('hs', 'heading', { text: 'Skills' }),
    block('sk', 'skills_group', { category: 'Web', items: 'CSS' }),
    block('he', 'heading', { text: 'Experience' }),
    block('j1', 'experience', { jobTitle: 'A', bullets: [] }),
    block('j2', 'experience', { jobTitle: 'B', bullets: [] }),
    block('hd', 'heading', { text: 'Education' }),
    block('ed', 'education', { degree: 'BSc' }),
  ];
  const { outline, refs } = planOutline(blocks);
  assert.deepEqual(outline.map((e) => [e.ref, e.section ?? null]), [
    ['B1', null], ['B2', null], ['B3', 'B2'], ['B4', null], ['B5', 'B4'], ['B6', 'B4'], ['B7', null], ['B8', 'B7'],
  ]);
  const order = { changed: true, topLevel: ['B1', 'B4', 'B7', 'B2'], sections: [{ heading: 'B4', children: ['B6', 'B5'] }], reason: '' };
  const plan = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B2', reason: 'web skills' }], order }, refs);
  assert.deepEqual(plan.order.blockIds, ['sum', 'he', 'j2', 'j1', 'hd', 'ed', 'hs', 'sk'], 'each heading keeps its blocks after it');
  assert.deepEqual(plan.hides.map((h) => h.blockIds), [['hs', 'sk']]);
  const across = { changed: true, topLevel: [], sections: [{ heading: 'B4', children: ['B5', 'B6', 'B8'] }], reason: '' };
  assert.equal(checkPlan(blocks, { explanation: '', order: across }, refs, { hide: false }).order, null);
  // Hiding the Experience section would leave no experience.
  assert.deepEqual(checkPlan(blocks, { explanation: '', hide: [{ ref: 'B4', reason: '' }] }, refs, { order: false }).hides, []);
});

test("a section's nested blocks stay first, ahead of the top-level ones after them", () => {
  const blocks = [
    block('h', 'heading', { text: 'Projects' }),
    block('n', 'custom', { title: 'Nested' }, { parentId: 'h' }),
    block('loose', 'custom', { title: 'Loose' }),
  ];
  const { refs } = planOutline(blocks);
  const order = { changed: true, topLevel: [], sections: [{ heading: 'B1', children: ['B3', 'B2'] }], reason: '' };
  assert.equal(checkPlan(blocks, { explanation: '', order }, refs, { hide: false }).order, null, 'comes out the same order');
});
