import test from 'node:test';
import assert from 'node:assert/strict';
import { anchorFor, landingSlice } from './landingAi.js';
import {
  editorUnsavedWork,
  hasUnsavedWork,
  landingUnsavedWork,
  leaveQuestion,
  lettersUnsavedWork,
  mustGuard,
} from './unsavedWork.js';

const block = (id, type, data = {}, extra = {}) => ({ id, type, parentId: null, visibleWeb: true, visiblePrint: true, data, ...extra });
const exp = { jobTitle: 'Dev', description: 'Built things.', bullets: [{ text: 'Shipped', visibleWeb: true, visiblePrint: true, children: [] }] };
const blocks = [block('sum', 'summary', { text: 'Engineer.' }), block('job', 'experience', exp)];

const ready = (blockId, target, baseData, proposedData) => ({
  blockId,
  target,
  status: 'ready',
  proposal: { blockId, target, baseData, proposedData },
});
const hide = (blockId, extra = {}) => ({
  key: `${blockId}:hide`,
  blockId,
  path: null,
  section: false,
  blockIds: [blockId],
  surfaces: ['web', 'print'],
  before: { visibleWeb: true, visiblePrint: true, text: null },
  ...extra,
});
const order = (list) => ({ blockIds: [...list].reverse().map((b) => b.id), basis: list.map((b) => b.id), basisParents: Object.fromEntries(list.map((b) => [b.id, null])) });
const idle = { waiting: 0, inFlight: 0, failed: 0 };

test('nothing open is nothing to ask about', () => {
  const work = editorUnsavedWork({ blocks });
  assert.equal(hasUnsavedWork(work), false);
  assert.equal(leaveQuestion(work), null);
  assert.equal(mustGuard(work, idle), false);
});

test('the save queue alone makes the guard step in, but asks nothing', () => {
  const work = editorUnsavedWork({ blocks });
  assert.equal(mustGuard(work, { ...idle, waiting: 1 }), true, 'a save on its debounce');
  assert.equal(mustGuard(work, { ...idle, inFlight: 1 }), true, 'a request in flight (an upload too)');
  assert.equal(mustGuard(work, { ...idle, failed: 1 }), true, 'a save that failed');
  assert.equal(leaveQuestion(work), null, 'the queue is flushed, and its failure asked about, before this');
});

test("the editor counts the rewrites the preview shows, not stale, loading or failed ones", () => {
  const aiProposals = {
    'sum:block': ready('sum', { kind: 'block' }, blocks[0].data, { text: 'Senior engineer.' }),
    'job:description': ready('job', { kind: 'description' }, exp, { ...exp, description: 'Built better things.' }),
    'job:block': { blockId: 'job', target: { kind: 'block' }, status: 'loading', proposal: null },
    'job:bullet:0': { blockId: 'job', target: { kind: 'bullet', path: [0] }, status: 'error', proposal: null, error: 'x' },
  };
  assert.equal(editorUnsavedWork({ blocks, aiProposals }).suggestions, 2);

  // The description edited since: its rewrite is no longer previewed.
  const edited = [blocks[0], block('job', 'experience', { ...exp, description: 'Built things myself.' })];
  assert.equal(editorUnsavedWork({ blocks: edited, aiProposals }).suggestions, 1);

  // A rewrite of a block that's gone isn't counted either.
  assert.equal(editorUnsavedWork({ blocks: [blocks[1]], aiProposals }).suggestions, 1);
});

test("the editor counts the plan's hides and order while they still apply", () => {
  const planHides = { 'sum:hide': hide('sum'), 'job:hide': hide('job') };
  const work = editorUnsavedWork({ blocks, planHides, planOrder: order(blocks) });
  assert.equal(work.hides, 2);
  assert.equal(work.order, true);

  // One hidden by hand since (applied), one whose block's flags changed (stale).
  const changed = [block('sum', 'summary', { text: 'Engineer.' }, { visibleWeb: false, visiblePrint: false }), block('job', 'experience', exp, { visiblePrint: false })];
  assert.equal(editorUnsavedWork({ blocks: changed, planHides }).hides, 0);

  // An order made for other blocks can't be applied, so it isn't counted.
  assert.equal(editorUnsavedWork({ blocks: [...blocks, block('new', 'summary')], planOrder: order(blocks) }).order, false);
});

test('the editor counts a tailoring run only while it runs, and every dirty dialog', () => {
  assert.equal(editorUnsavedWork({ blocks, tailorRun: { finished: false, done: 1, total: 4 } }).tailoring, true);
  assert.equal(editorUnsavedWork({ blocks, tailorRun: { finished: true, done: 4, total: 4 } }).tailoring, false);
  const work = editorUnsavedWork({ blocks, forms: ['Resume settings'] });
  assert.equal(hasUnsavedWork(work), true);
  assert.equal(leaveQuestion(work), 'You have unsaved changes in Resume settings. Leave and discard it?');
});

test('the question names everything with its count', () => {
  const aiProposals = {
    a: ready('sum', { kind: 'block' }, blocks[0].data, { text: 'x' }),
    b: ready('job', { kind: 'block' }, exp, exp),
    c: ready('job', { kind: 'description' }, exp, exp),
  };
  const work = editorUnsavedWork({ blocks, aiProposals, tailorRun: { finished: false } });
  assert.equal(leaveQuestion(work), "You have 3 AI suggestions you haven't accepted and a tailoring run in progress. Leave and discard them?");

  const one = editorUnsavedWork({ blocks, aiProposals: { a: aiProposals.a } });
  assert.equal(leaveQuestion(one), "You have an AI suggestion you haven't accepted. Leave and discard it?");

  const plan = editorUnsavedWork({ blocks, aiProposals: { a: aiProposals.a }, planHides: { s: hide('sum') }, planOrder: order(blocks), forms: ['Resume settings', 'Account Settings'] });
  assert.equal(
    leaveQuestion(plan),
    "You have an AI suggestion, a suggested hide and a suggested section order you haven't accepted and unsaved changes in Resume settings and Account Settings. Leave and discard them?"
  );
});

test("cover letters count every letter's previewed rewrites", () => {
  const data = { salutation: 'Dear,', paragraphs: ['A', 'B'], closing: 'Best,' };
  const letters = [
    { id: 'l1', data },
    { id: 'l2', data: { ...data, paragraphs: ['A', 'B edited'] } },
  ];
  const entry = (letterId, target, status = 'ready') => ({
    letterId,
    target,
    status,
    proposal: status === 'ready' ? { target, baseData: data, proposedData: { ...data, paragraphs: ['X', 'Y'] } } : null,
  });
  const aiEntries = {
    'l1:paragraph:0': entry('l1', { kind: 'paragraph', index: 0 }),
    'l1:paragraph:1': entry('l1', { kind: 'paragraph', index: 1 }),
    'l2:paragraph:1': entry('l2', { kind: 'paragraph', index: 1 }), // its paragraph was edited since
    'l2:letter': entry('l2', { kind: 'letter' }, 'loading'),
  };
  const work = lettersUnsavedWork({ letters, aiEntries });
  assert.equal(work.suggestions, 2);
  assert.equal(leaveQuestion(work), "You have 2 AI suggestions you haven't accepted. Leave and discard them?");
  assert.equal(hasUnsavedWork(lettersUnsavedWork({ letters: null, aiEntries: {} })), false, 'not loaded yet');
});

test('the landing page counts its suggestions that are still in place and unedited', () => {
  const landing = { headline: 'Jo', subheadline: 'Engineer', sections: [{ id: 'intro', kind: 'text', title: '', body: 'Hello.' }] };
  const proposal = (target, after) => ({ id: targetKeyOf(target), target, before: landingSlice(landing, target), after, anchor: anchorFor(landing, target) });
  const aiProposals = [proposal({ kind: 'headline' }, 'Jo Smith'), proposal({ kind: 'text', sectionId: 'intro' }, 'Hi there.')];
  assert.equal(landingUnsavedWork({ landing, aiProposals }).suggestions, 2);
  assert.equal(landingUnsavedWork({ landing: { ...landing, headline: 'Joanna' }, aiProposals }).suggestions, 1, 'the headline was edited since');
  assert.equal(landingUnsavedWork({ landing: { ...landing, sections: [] }, aiProposals }).suggestions, 1, 'its section is gone');
  assert.equal(hasUnsavedWork(landingUnsavedWork({ landing: null, aiProposals })), false, 'not loaded yet');
});

function targetKeyOf(target) {
  return target.sectionId ? `${target.kind}:${target.sectionId}` : target.kind;
}
