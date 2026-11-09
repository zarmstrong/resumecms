import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TAILOR_TYPES, PLAN_KEY, TAILOR_TYPES, createTailorRun, planItem, tailorItems } from './tailorRun.js';

const block = (id, type, data, { web = true, print = true } = {}) => ({ id, type, data, visibleWeb: web, visiblePrint: print });

test('a run covers summaries, experience and skills unless told otherwise', () => {
  assert.deepEqual(DEFAULT_TAILOR_TYPES, ['summary', 'executive_summary', 'experience', 'skills_group']);
  assert.deepEqual(TAILOR_TYPES.map((t) => t.type), ['summary', 'executive_summary', 'experience', 'skills_group', 'heading', 'custom']);
});

test('one request per section of the chosen types, plus an experience description, skipping hidden and empty ones', () => {
  const blocks = [
    block('h', 'heading', { text: 'Experience' }),
    block('s', 'summary', { text: 'Engineer.' }),
    block('e1', 'experience', { jobTitle: 'SRE', company: 'Acme', bullets: [{ text: 'Ran on-call.' }], description: 'Platform team.' }),
    block('e2', 'experience', { jobTitle: 'Dev', bullets: [{ text: '', children: [{ text: 'Shipped.' }] }] }),
    block('e3', 'experience', { jobTitle: 'Empty', bullets: [] }),
    block('k', 'skills_group', { category: 'Cloud', items: 'AWS' }),
    block('k2', 'skills_group', { category: 'Nothing', items: ' ' }),
    block('x', 'experience', { jobTitle: 'Hidden', bullets: ['Secret'] }, { web: false, print: false }),
    block('w', 'summary', { text: 'Web only.' }, { print: false }),
    block('c', 'custom', { title: 'Talks', items: [{ text: 'A talk' }] }),
    block('ed', 'education', { degree: 'BSc' }),
  ];
  const items = tailorItems(blocks, ['summary', 'experience', 'skills_group', 'education']);
  assert.deepEqual(
    items.map((i) => [i.key, i.target.kind]),
    [
      ['s:block', 'block'],
      ['e1:block', 'block'],
      ['e1:description', 'description'],
      ['e2:block', 'block'],
      ['k:block', 'block'],
      ['w:block', 'block'],
    ]
  );
  assert.equal(items[1].label, 'Experience Entry: SRE, Acme');
  assert.equal(items[2].label, 'Experience Entry: SRE, Acme, description');
  assert.equal(items[4].label, 'Skills Row: Cloud');
  assert.deepEqual(tailorItems(blocks, ['heading', 'custom']).map((i) => i.key), ['h:block', 'c:block']);
  // a custom section saved before bodyType existed keeps its text in `body`
  const legacy = block('old', 'custom', { title: 'Awards', items: [{ heading: '', body: 'Best paper' }] });
  assert.deepEqual(tailorItems([legacy, block('none', 'custom', { items: [{}] })], ['custom']).map((i) => i.key), ['old:block']);
  assert.deepEqual(tailorItems(blocks, []), []);
});

test('an executive summary is tailored when any of its three fields has text, and labeled by its headline', () => {
  const items = tailorItems(
    [
      block('a', 'executive_summary', { headline: 'Platform leader', text: '', highlights: [] }),
      block('b', 'executive_summary', { headline: '', text: '', highlights: ['', 'Grew the team'] }),
      block('c', 'executive_summary', { headline: ' ', text: '', highlights: ['', ' '] }),
    ],
    ['executive_summary']
  );
  assert.deepEqual(items.map((i) => i.key), ['a:block', 'b:block']);
  assert.equal(items[0].label, 'Executive Summary: Platform leader');
  assert.equal(items[1].label, 'Executive Summary');
});

// A request the test settles by hand.
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setImmediate(r));

function harness(count, concurrency = 2, items = Array.from({ length: count }, (_, i) => ({ key: `k${i}` }))) {
  const pending = new Map();
  const started = [];
  const updates = [];
  const run = createTailorRun({
    items,
    concurrency,
    run: (item) => {
      started.push(item.key);
      const d = deferred();
      pending.set(item.key, d);
      return d.promise;
    },
    onUpdate: (state) => updates.push(state),
  });
  return { run, pending, started, updates, last: () => updates.at(-1) };
}

test('runs at most `concurrency` at a time, in order, and finishes with every result counted', async () => {
  const h = harness(4);
  await flush();
  assert.deepEqual(h.started, ['k0', 'k1']);
  assert.deepEqual({ ...h.last(), failed: undefined }, { total: 4, done: 0, skipped: 0, suggestedHidden: 0, failed: undefined, running: 2, cancelled: false, finished: false });

  h.pending.get('k1').resolve({ ok: true });
  await flush();
  assert.deepEqual(h.started, ['k0', 'k1', 'k2'], 'a finished one makes room for the next');
  h.pending.get('k0').resolve({ ok: false, error: '502 bad model output' });
  h.pending.get('k2').resolve({ superseded: true });
  await flush();
  h.pending.get('k3').reject(new Error('Network down'));
  await flush();

  const state = h.last();
  assert.equal(state.done, 1);
  assert.equal(state.skipped, 1, 'a superseded one is skipped, not done or failed');
  assert.deepEqual(state.failed.map((f) => [f.item.key, f.error]), [['k0', '502 bad model output'], ['k3', 'Network down']]);
  assert.equal(state.running, 0);
  assert.equal(state.finished, true);
});

test('cancel sends nothing more, returns what was in flight, and ignores its late results', async () => {
  const h = harness(5);
  await flush();
  const abandoned = h.run.cancel();
  assert.deepEqual(abandoned.map((i) => i.key), ['k0', 'k1']);
  assert.deepEqual({ cancelled: h.last().cancelled, finished: h.last().finished, running: h.last().running }, { cancelled: true, finished: true, running: 0 });
  const updatesAfterCancel = h.updates.length;

  h.pending.get('k0').resolve({ ok: true });
  h.pending.get('k1').resolve({ ok: false, error: 'late' });
  await flush();
  assert.deepEqual(h.started, ['k0', 'k1'], 'nothing more was sent');
  assert.equal(h.updates.length, updatesAfterCancel, 'late results change nothing');
  assert.equal(h.last().done, 0);
  assert.deepEqual(h.run.cancel(), [], 'a second cancel is a no-op');
});

test('an empty run is finished straight away', () => {
  const h = harness(0);
  assert.deepEqual(h.updates, [{ total: 0, done: 0, skipped: 0, suggestedHidden: 0, failed: [], running: 0, cancelled: false, finished: true }]);
});

test('cancelling a run that has finished changes nothing', async () => {
  const h = harness(1);
  await flush();
  h.pending.get('k0').resolve({ ok: false, error: 'nope' });
  await flush();
  const updates = h.updates.length;
  assert.deepEqual(h.run.cancel(), []);
  assert.equal(h.updates.length, updates);
  assert.equal(h.last().cancelled, false, 'its failures can still be retried');
});

test('the plan goes first and alone, and its hides take their blocks\' rewrites out of the run', async () => {
  const items = [
    planItem({ hide: true, order: true, hideFrom: 'both' }),
    { key: 'a:block', blockId: 'a' },
    { key: 'b:block', blockId: 'b' },
    { key: 'b:description', blockId: 'b' },
    { key: 'c:block', blockId: 'c' },
  ];
  const h = harness(0, 3, items);
  await flush();
  assert.deepEqual(h.started, [PLAN_KEY], 'nothing starts alongside the plan');
  assert.equal(h.last().total, 5);
  h.pending.get(PLAN_KEY).resolve({ ok: true, skipBlockIds: new Set(['b']) });
  await flush();
  assert.deepEqual(h.started, [PLAN_KEY, 'a:block', 'c:block']);
  assert.equal(h.last().suggestedHidden, 2);
  h.pending.get('a:block').resolve({ ok: true });
  h.pending.get('c:block').resolve({ ok: true });
  await flush();
  assert.deepEqual({ done: h.last().done, suggestedHidden: h.last().suggestedHidden, finished: h.last().finished }, { done: 3, suggestedHidden: 2, finished: true });
});

test('a failed plan lets the rewrites go ahead', async () => {
  const h = harness(0, 2, [planItem({ hide: true }), { key: 'a:block', blockId: 'a' }]);
  await flush();
  h.pending.get(PLAN_KEY).resolve({ ok: false, error: 'AI is down' });
  await flush();
  assert.deepEqual(h.started, [PLAN_KEY, 'a:block']);
  assert.deepEqual(h.last().failed.map((f) => f.item.label), ['Suggestions of what to hide']);
});

test('a plan waits for rewrites already out, as on a retry', async () => {
  const h = harness(0, 2, [{ key: 'a:block', blockId: 'a' }, planItem({ order: true }), { key: 'c:block', blockId: 'c' }]);
  await flush();
  assert.deepEqual(h.started, ['a:block']);
  h.pending.get('a:block').resolve({ ok: true });
  await flush();
  assert.deepEqual(h.started, ['a:block', PLAN_KEY]);
  assert.equal(planItem({ order: true }).label, 'A suggested section order');
});
