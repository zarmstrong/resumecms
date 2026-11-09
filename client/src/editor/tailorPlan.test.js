import test from 'node:test';
import assert from 'node:assert/strict';
import { isProposalStale, proposalKey } from './aiReview.js';
import {
  acceptAllWithPlan,
  applyHide,
  applyOrder,
  hideBulletInData,
  hideKey,
  hidePatches,
  isHideApplied,
  isHideStale,
  isOrderStale,
  previewPlan,
  sectionMembers,
  previewedHides,
  rebaseOnBulletHide,
  receivePlan,
  relocateHide,
  suggestedHiddenIds,
} from './tailorPlan.js';

const bullet = (text, children = []) => ({ text, visibleWeb: true, visiblePrint: true, children });
const block = (id, type, data = {}, extra = {}) => ({ id, type, parentId: null, visibleWeb: true, visiblePrint: true, data, ...extra });

function draft() {
  return [
    block('sum', 'summary', { text: 'Engineer.' }),
    block('job', 'experience', { jobTitle: 'Dev', bullets: [bullet('Ran security', [bullet('Bug bounty')]), bullet('Wrote CSS'), 'Legacy string'] }),
    block('h', 'heading', { text: 'Projects' }),
    block('p1', 'custom', { title: 'A' }, { parentId: 'h' }),
    block('p2', 'custom', { title: 'B' }, { parentId: 'h' }),
  ];
}

const before = (extra = {}) => ({ visibleWeb: true, visiblePrint: true, text: null, ...extra });
// What the server sends (server/src/ai/tailorPlan.js).
function serverPlan(blocks = draft()) {
  return {
    explanation: 'x',
    hides: [
      { key: 'job:hide:1', blockId: 'job', path: [1], section: false, blockIds: ['job'], reason: 'CSS', before: before({ text: 'Wrote CSS' }) },
      { key: 'h:hide', blockId: 'h', path: null, section: true, blockIds: ['h', 'p1', 'p2'], reason: 'thin', before: before() },
      { key: 'gone:hide', blockId: 'gone', path: null, section: false, blockIds: ['gone'], reason: 'deleted here', before: before() },
    ],
    order: { blockIds: ['sum', 'h', 'p2', 'p1', 'job'], basis: blocks.map((b) => b.id), reason: 'projects first' },
  };
}

test('a hide key is a proposal key with a hide target, as the server makes it', () => {
  assert.equal(hideKey({ blockId: 'b', path: null }), 'b:hide');
  assert.equal(hideKey({ blockId: 'b', path: [1, 0] }), 'b:hide:1.0');
  assert.equal(proposalKey('b', { kind: 'hide', path: [2] }), 'b:hide:2');
});

test('receivePlan keeps the surfaces, anchors bullets, and drops hides of blocks gone here', () => {
  const blocks = draft();
  const { hides, order } = receivePlan(serverPlan(), blocks, 'print');
  assert.deepEqual(Object.keys(hides), ['job:hide:1', 'h:hide']);
  assert.deepEqual(hides['h:hide'].surfaces, ['print']);
  assert.equal(hides['job:hide:1'].anchorData, blocks[1].data);
  assert.equal(hides['h:hide'].anchorData, undefined);
  assert.deepEqual(order.basisParents, { sum: null, job: null, h: null, p1: 'h', p2: 'h' });
  assert.equal(receivePlan({ hides: [], order: null }, blocks).order, null);
});

test('applyHide hides blocks and bullets on the chosen surfaces only', () => {
  const blocks = draft();
  const { hides } = receivePlan(serverPlan(), blocks, 'both');
  const section = applyHide(blocks, hides['h:hide']);
  assert.deepEqual(section.filter((b) => !b.visibleWeb && !b.visiblePrint).map((b) => b.id), ['h', 'p1', 'p2']);
  assert.equal(blocks[2].visibleWeb, true, 'not mutated');
  const print = applyHide(blocks, { ...hides['h:hide'], surfaces: ['print'] });
  assert.deepEqual([print[3].visibleWeb, print[3].visiblePrint], [true, false]);
  const b = applyHide(blocks, { ...hides['job:hide:1'], surfaces: ['print'] });
  assert.deepEqual(b[1].data.bullets[1], { ...bullet('Wrote CSS'), visiblePrint: false });
  assert.equal(b[1].data.bullets[0], blocks[1].data.bullets[0], 'other bullets kept as stored');
  // A legacy string bullet is normalized on the way.
  assert.deepEqual(hideBulletInData(blocks[1].data, [2], ['web', 'print']).bullets[2], { ...bullet('Legacy string'), visibleWeb: false, visiblePrint: false });
  assert.equal(hideBulletInData(blocks[1].data, [9], ['web']), blocks[1].data, 'a missing bullet changes nothing');
});

test('hidePatches only patches what still shows', () => {
  const blocks = draft();
  blocks[3] = { ...blocks[3], visiblePrint: false };
  const { hides } = receivePlan(serverPlan(), blocks, 'print');
  assert.deepEqual(hidePatches(blocks, hides['h:hide']), [
    { blockId: 'h', patch: { visiblePrint: false } },
    { blockId: 'p2', patch: { visiblePrint: false } },
  ]);
});

test('applyOrder follows the plan, putting blocks added since last', () => {
  const blocks = [...draft(), block('new', 'education')];
  const { order } = receivePlan(serverPlan(draft()), draft());
  assert.deepEqual(applyOrder(blocks, order).map((b) => b.id), ['sum', 'h', 'p2', 'p1', 'job', 'new']);
});

test('staleness: a flag change, a section change, a bullet edit, a reorder', () => {
  const blocks = draft();
  const { hides, order } = receivePlan(serverPlan(), blocks);
  const section = hides['h:hide'];
  const css = hides['job:hide:1'];
  assert.equal(isHideStale(blocks, section), false);
  assert.equal(isHideStale(blocks, css), false);
  assert.equal(isOrderStale(blocks, order), false);

  const flagged = blocks.map((b) => (b.id === 'h' ? { ...b, visiblePrint: false } : b));
  assert.equal(isHideStale(flagged, section), true);
  const moved = [{ ...blocks[4], parentId: null }, ...blocks.slice(0, 4)];
  assert.equal(isHideStale(moved, section), true, 'a block left the section');
  const unnested = blocks.map((b) => (b.id === 'p2' ? { ...b, parentId: null } : b));
  assert.equal(isHideStale(unnested, section), false, 'still right after the heading, so still in its section');
  const reordered = [...blocks.slice(0, 3), blocks[4], blocks[3]];
  assert.equal(isHideStale(reordered, section), false, 'the plan’s own order can reorder the section');
  assert.equal(isOrderStale(unnested, order), true, 'nesting changed');
  const edited = blocks.map((b) => (b.id === 'job' ? { ...b, data: { ...b.data, bullets: [b.data.bullets[0], bullet('Wrote Sass')] } } : b));
  assert.equal(isHideStale(edited, css), true);
  assert.equal(isOrderStale([blocks[1], blocks[0], ...blocks.slice(2)], order), true);
  assert.equal(isOrderStale([...blocks, block('new', 'education')], order), true);
  assert.equal(isHideStale(blocks.filter((b) => b.id !== 'h'), section), true);
});

test('a hide already in effect counts as applied', () => {
  const blocks = draft();
  const { hides } = receivePlan(serverPlan(), blocks, 'print');
  const hidden = blocks.map((b) => (['h', 'p1', 'p2'].includes(b.id) ? { ...b, visiblePrint: false } : b));
  assert.equal(isHideApplied(hidden, hides['h:hide']), true);
  assert.equal(isHideApplied(blocks, hides['h:hide']), false);
  const bulletHidden = applyHide(blocks, hides['job:hide:1']);
  assert.equal(isHideApplied(bulletHidden, hides['job:hide:1']), true);
});

test('a bullet hide follows its bullet after an edit above it, and goes with it', () => {
  const blocks = draft();
  const { hides } = receivePlan(serverPlan(), blocks);
  const css = hides['job:hide:1'];
  const data = blocks[1].data;
  // A new bullet at the top: CSS moves from 1 to 2.
  const inserted = { ...data, bullets: [bullet('New first'), ...data.bullets] };
  const moved = relocateHide(css, inserted);
  assert.deepEqual(moved.path, [2]);
  assert.equal(moved.key, 'job:hide:2');
  assert.equal(moved.anchorData, inserted);
  assert.equal(isHideStale([{ ...blocks[1], data: inserted }], moved), false);
  assert.equal(relocateHide(css, data), css, 'unchanged');
  const removed = { ...data, bullets: [data.bullets[0]] };
  assert.equal(relocateHide(css, removed), null);
});

test('the preview leaves out stale hides and those under a restructuring rewrite', () => {
  const blocks = draft();
  const { hides, order } = receivePlan(serverPlan(), blocks);
  assert.deepEqual(previewedHides(blocks, hides).map((h) => h.key), ['job:hide:1', 'h:hide']);
  const restructuring = [{ blockId: 'job', target: { kind: 'block' }, allowBulletRestructure: true }];
  assert.deepEqual(previewedHides(blocks, hides, restructuring).map((h) => h.key), ['h:hide']);
  const subOnly = { ...hides['job:hide:1'], path: [0, 0], key: 'job:hide:0.0', before: before({ text: 'Bug bounty' }) };
  const bulletRestructuring = [{ blockId: 'job', target: { kind: 'bullet', path: [0] }, allowBulletRestructure: true }];
  assert.deepEqual(previewedHides(blocks, { [subOnly.key]: subOnly }, bulletRestructuring), []);
  assert.equal(previewedHides(blocks, { [subOnly.key]: subOnly }, restructuring.map((p) => ({ ...p, allowBulletRestructure: false }))).length, 1);

  const shown = previewPlan(blocks, blocks, hides, order);
  assert.deepEqual(shown.map((b) => b.id), ['sum', 'h', 'p2', 'p1', 'job']);
  assert.equal(shown.find((b) => b.id === 'p1').visibleWeb, false);
  assert.equal(shown.find((b) => b.id === 'job').data.bullets[1].visibleWeb, false);
  const reordered = [blocks[1], blocks[0], ...blocks.slice(2)];
  assert.deepEqual(previewPlan(reordered, reordered, {}, order).map((b) => b.id), reordered.map((b) => b.id), 'a stale order is not shown');
});

test('accepting a bullet hide rebases fresh rewrites of that bullet or block', () => {
  const blocks = draft();
  const data = blocks[1].data;
  const rewrite = (target, proposedBullets, extra = {}) => ({
    blockId: 'job',
    target,
    baseData: data,
    proposedData: { ...data, bullets: proposedBullets },
    allowBulletRestructure: false,
    ...extra,
  });
  const whole = rewrite({ kind: 'block' }, [bullet('Led security', [bullet('Ran bounty')]), bullet('Styled pages'), 'Legacy, reworded']);
  const rebased = rebaseOnBulletHide('experience', whole, data, [1], ['print']);
  assert.equal(rebased.proposedData.bullets[1].visiblePrint, false);
  assert.equal(rebased.proposedData.bullets[1].text, 'Styled pages');
  assert.equal(rebased.baseData.bullets[1].visiblePrint, false);
  // Now it isn't stale against the data with the hide in it.
  const after = hideBulletInData(data, [1], ['print']);
  assert.equal(isProposalStale('experience', rebased, after), false);
  assert.equal(isProposalStale('experience', whole, after), true, 'without the rebase it would be');

  assert.equal(rebaseOnBulletHide('experience', { ...whole, allowBulletRestructure: true }, data, [1], ['print']).proposedData.bullets[1].visiblePrint, true);
  const edited = { ...data, tagline: 'changed since' };
  assert.equal(rebaseOnBulletHide('experience', whole, edited, [1], ['print']), whole, 'a stale rewrite is left alone');

  const top = rewrite({ kind: 'bullet', path: [0] }, [bullet('Led security', [bullet('Ran bounty')]), data.bullets[1], data.bullets[2]]);
  assert.equal(rebaseOnBulletHide('experience', top, data, [0, 0], ['web']).proposedData.bullets[0].children[0].visibleWeb, false);
  assert.equal(rebaseOnBulletHide('experience', top, data, [1], ['web']), top, 'another bullet');
  const description = rewrite({ kind: 'description' }, data.bullets);
  assert.equal(rebaseOnBulletHide('experience', description, data, [1], ['web']), description);
});

test('Accept all takes rewrites, fresh hides and a fresh order together', () => {
  const blocks = draft();
  const { hides, order } = receivePlan(serverPlan(), blocks);
  const summary = { blockId: 'sum', target: { kind: 'block' }, baseData: blocks[0].data, proposedData: { text: 'Security engineer.' } };
  const jobRewrite = {
    blockId: 'job',
    target: { kind: 'bullet', path: [0] },
    baseData: blocks[1].data,
    proposedData: { ...blocks[1].data, bullets: [bullet('Led security', [bullet('Bug bounty')]), ...blocks[1].data.bullets.slice(1)] },
  };
  const stale = { ...hides['h:hide'], key: 'p1:hide', blockId: 'p1', section: false, blockIds: ['p1'], before: before({ visiblePrint: false }) };
  const plan = acceptAllWithPlan(blocks, [summary, jobRewrite], { ...hides, [stale.key]: stale }, order);
  assert.deepEqual(plan.accepted, [summary, jobRewrite]);
  assert.deepEqual(plan.hides, ['job:hide:1', 'h:hide']);
  assert.deepEqual(plan.skippedHides, ['p1:hide']);
  const job = plan.changes.find((c) => c.blockId === 'job').data;
  assert.equal(job.bullets[0].text, 'Led security', 'the rewrite');
  assert.equal(job.bullets[1].visibleWeb, false, 'and the hide, in one change');
  assert.deepEqual(plan.patches.map((p) => p.blockId), ['h', 'p1', 'p2']);
  assert.equal(plan.order, order);
  const moved = [blocks[1], blocks[0], ...blocks.slice(2)];
  const later = acceptAllWithPlan(moved, [], {}, order);
  assert.equal(later.order, null);
  assert.equal(later.orderStale, true);
});

test('a run skips rewrites of blocks a block or section hide is for', () => {
  const { hides } = receivePlan(serverPlan(), draft());
  assert.deepEqual([...suggestedHiddenIds(hides)].sort(), ['h', 'p1', 'p2']);
});

test("a heading's section is its nested blocks, then the top-level ones up to the next heading", () => {
  const blocks = [
    block('intro', 'summary'),
    block('h1', 'heading'),
    block('n', 'education', {}, { parentId: 'h1' }),
    block('loose', 'education'),
    block('h2', 'heading'),
    block('x', 'experience'),
  ];
  assert.deepEqual(sectionMembers(blocks, 'h1'), ['n', 'loose']);
  assert.deepEqual(sectionMembers(blocks, 'h2'), ['x']);
  assert.deepEqual(sectionMembers(blocks, 'intro'), []);
});
