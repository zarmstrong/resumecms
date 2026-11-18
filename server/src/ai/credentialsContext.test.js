import test from 'node:test';
import assert from 'node:assert/strict';
import { letterResumeContext } from './letterWriting.js';
import { planOutline, checkPlan } from './tailorPlan.js';
import { resumeOutline } from './brief.js';
import { landingProfile } from './landingRewrite.js';
import { REWRITABLE_TYPES } from './rewritableFields.js';

const credential = (id, flags = {}, data = {}) => ({
  id, type: 'credentials', parentId: null, visibleWeb: true, visiblePrint: true,
  data: { kind: 'license', name: id, issuer: 'Institute', number: 'PRIVATE-AI-NUMBER', issued: '2020', expires: '2021', url: 'https://example.com/verify', ...data },
  ...flags,
});
const summary = (flags = {}) => ({ id: 'summary', type: 'summary', data: {}, visibleWeb: true, visiblePrint: true, ...flags });

test('credentials are factual AI context without numbers or URLs, even when expired', () => {
  const blocks = [credential('License')];
  const facts = { kind: 'license', name: 'License', issuer: 'Institute', issued: '2020', expires: '2021' };
  const short = [{ name: 'License', issuer: 'Institute' }];
  const letter = letterResumeContext(blocks);
  const plan = planOutline(blocks);
  const outline = resumeOutline(blocks, summary());
  const profile = landingProfile({ blocks });
  assert.deepEqual(letter, { credentials: [facts] });
  assert.deepEqual(plan.outline, [{ ref: 'B1', type: 'credentials', shows: ['web', 'pdf'], ...facts }]);
  assert.deepEqual(outline, { credentials: short });
  assert.deepEqual(profile, { credentials: short });
  for (const context of [letter, plan.outline, outline, profile]) {
    assert.doesNotMatch(JSON.stringify(context), /PRIVATE-AI-NUMBER|number|https:/);
  }
  assert.ok(!REWRITABLE_TYPES.has('credentials'));
});

test('each AI builder keeps its visibility rule for credentials', () => {
  const blocks = [credential('both'), credential('web', { visiblePrint: false }), credential('print', { visibleWeb: false }), credential('hidden', { visibleWeb: false, visiblePrint: false })];
  assert.deepEqual(letterResumeContext(blocks).credentials.map((c) => c.name), ['both', 'web', 'print']);
  assert.deepEqual(planOutline(blocks).outline.map((c) => c.name), ['both', 'web', 'print']);
  assert.deepEqual(resumeOutline(blocks, summary()).credentials.map((c) => c.name), ['both']);
  assert.deepEqual(resumeOutline(blocks, summary({ visiblePrint: false })).credentials.map((c) => c.name), ['both', 'web']);
  assert.deepEqual(resumeOutline(blocks, summary({ visibleWeb: false })).credentials.map((c) => c.name), ['both', 'print']);
  assert.deepEqual(resumeOutline(blocks, summary({ visibleWeb: false, visiblePrint: false })).credentials.map((c) => c.name), ['both']);
  assert.deepEqual(landingProfile({ blocks }).credentials.map((c) => c.name), ['both', 'web']);
  const hidden = [blocks.at(-1)];
  assert.equal(letterResumeContext(hidden), null);
  assert.deepEqual(planOutline(hidden).outline, []);
  assert.equal(resumeOutline(hidden, summary()), null);
  assert.equal(landingProfile({ blocks: hidden }), null);
});

test('letter context compacts empty fields and skips unnamed credentials', () => {
  assert.deepEqual(letterResumeContext([credential('x', {}, { kind: '', issuer: '', issued: '', expires: '' })]), { credentials: [{ name: 'x' }] });
  assert.equal(letterResumeContext([credential('x', {}, { name: '' })]), null);
});

test('a tailoring plan may hide a credential by its ref', () => {
  const blocks = [credential('license')];
  const { refs } = planOutline(blocks);
  const plan = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B1', reason: 'Less relevant' }] }, refs, { hide: true, order: false });
  assert.deepEqual(plan.hides.map((h) => [h.blockId, h.reason]), [['license', 'Less relevant']]);
});
