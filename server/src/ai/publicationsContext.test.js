import test from 'node:test';
import assert from 'node:assert/strict';
import { letterResumeContext } from './letterWriting.js';
import { planOutline, checkPlan } from './tailorPlan.js';
import { resumeOutline } from './brief.js';
import { landingProfile } from './landingRewrite.js';
import { REWRITABLE_TYPES } from './rewritableFields.js';

const publication = (id, flags = {}, data = {}) => ({
  id, type: 'publications', parentId: null, visibleWeb: true, visiblePrint: true,
  data: { kind: 'paper', title: id, outlet: 'Journal', date: '2024', url: 'https://example.com/paper', doi: '10.1234/abcd', note: 'with A. Author', ...data },
  ...flags,
});
const summary = (flags = {}) => ({ id: 'summary', type: 'summary', data: {}, visibleWeb: true, visiblePrint: true, ...flags });

test('publications are factual AI context without links or DOIs', () => {
  const blocks = [publication('Paper')];
  const facts = { kind: 'paper', title: 'Paper', outlet: 'Journal', date: '2024', note: 'with A. Author' };
  const short = [{ title: 'Paper', outlet: 'Journal' }];
  const letter = letterResumeContext(blocks);
  const plan = planOutline(blocks);
  const outline = resumeOutline(blocks, summary());
  const profile = landingProfile({ blocks });
  assert.deepEqual(letter, { publications: [facts] });
  assert.deepEqual(plan.outline, [{ ref: 'B1', type: 'publications', shows: ['web', 'pdf'], kind: 'paper', title: 'Paper', outlet: 'Journal', date: '2024' }]);
  assert.deepEqual(outline, { publications: short });
  assert.deepEqual(profile, { publications: short });
  for (const context of [letter, plan.outline, outline, profile]) {
    assert.doesNotMatch(JSON.stringify(context), /doi\.org|10\.1234|https:/);
  }
  assert.ok(!REWRITABLE_TYPES.has('publications'));
});

test('each AI builder keeps its visibility rule for publications', () => {
  const blocks = [publication('both'), publication('web', { visiblePrint: false }), publication('print', { visibleWeb: false }), publication('hidden', { visibleWeb: false, visiblePrint: false })];
  assert.deepEqual(letterResumeContext(blocks).publications.map((p) => p.title), ['both', 'web', 'print']);
  assert.deepEqual(planOutline(blocks).outline.map((p) => p.title), ['both', 'web', 'print']);
  assert.deepEqual(resumeOutline(blocks, summary()).publications.map((p) => p.title), ['both']);
  assert.deepEqual(resumeOutline(blocks, summary({ visiblePrint: false })).publications.map((p) => p.title), ['both', 'web']);
  assert.deepEqual(resumeOutline(blocks, summary({ visibleWeb: false })).publications.map((p) => p.title), ['both', 'print']);
  assert.deepEqual(resumeOutline(blocks, summary({ visibleWeb: false, visiblePrint: false })).publications.map((p) => p.title), ['both']);
  assert.deepEqual(landingProfile({ blocks }).publications.map((p) => p.title), ['both', 'web']);
  const hidden = [blocks.at(-1)];
  assert.equal(letterResumeContext(hidden), null);
  assert.deepEqual(planOutline(hidden).outline, []);
  assert.equal(resumeOutline(hidden, summary()), null);
  assert.equal(landingProfile({ blocks: hidden }), null);
});

test('letter context compacts empty fields and skips untitled publications', () => {
  assert.deepEqual(letterResumeContext([publication('x', {}, { kind: '', outlet: '', date: '', note: '' })]), { publications: [{ title: 'x' }] });
  assert.equal(letterResumeContext([publication('x', {}, { title: '' })]), null);
});

test('a tailoring plan may hide a publication by its ref', () => {
  const blocks = [publication('paper')];
  const { refs } = planOutline(blocks);
  const plan = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B1', reason: 'Less relevant' }] }, refs, { hide: true, order: false });
  assert.deepEqual(plan.hides.map((h) => [h.blockId, h.reason]), [['paper', 'Less relevant']]);
});
