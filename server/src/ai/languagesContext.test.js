import test from 'node:test';
import assert from 'node:assert/strict';
import { letterResumeContext } from './letterWriting.js';
import { planOutline, checkPlan } from './tailorPlan.js';
import { resumeOutline } from './brief.js';
import { landingProfile } from './landingRewrite.js';
import { REWRITABLE_TYPES } from './rewritableFields.js';

const languages = (entries, flags = {}) => ({
  id: 'languages', type: 'languages', parentId: null, visibleWeb: true, visiblePrint: true,
  data: { entries }, ...flags,
});
const summary = (flags = {}) => ({ id: 'summary', type: 'summary', data: {}, visibleWeb: true, visiblePrint: true, ...flags });

test('languages are factual AI context, kept as written and never rewritten', () => {
  const blocks = [languages([{ language: 'Spanish', level: 'Fluent' }, { language: 'English' }])];
  const facts = [{ language: 'Spanish', level: 'Fluent' }, { language: 'English' }];
  assert.deepEqual(letterResumeContext(blocks), { languages: facts });
  assert.deepEqual(planOutline(blocks).outline, [{ ref: 'B1', type: 'languages', shows: ['web', 'pdf'], languages: 'Spanish (Fluent), English' }]);
  assert.deepEqual(resumeOutline(blocks, summary()), { languages: facts });
  assert.deepEqual(landingProfile({ blocks }), { languages: facts });
  assert.ok(!REWRITABLE_TYPES.has('languages'));
});

test('each AI builder keeps its visibility rule for languages', () => {
  const blocks = [
    languages([{ language: 'both' }]),
    languages([{ language: 'web' }], { visiblePrint: false }),
    languages([{ language: 'print' }], { visibleWeb: false }),
    languages([{ language: 'hidden' }], { visibleWeb: false, visiblePrint: false }),
  ];
  const names = (list) => list.map((l) => l.language);
  assert.deepEqual(names(letterResumeContext(blocks).languages), ['both', 'web', 'print']);
  assert.deepEqual(names(planOutline(blocks).outline.map((o) => ({ language: o.languages }))), ['both', 'web', 'print']);
  assert.deepEqual(names(resumeOutline(blocks, summary()).languages), ['both']);
  assert.deepEqual(names(resumeOutline(blocks, summary({ visiblePrint: false })).languages), ['both', 'web']);
  assert.deepEqual(names(resumeOutline(blocks, summary({ visibleWeb: false })).languages), ['both', 'print']);
  assert.deepEqual(names(resumeOutline(blocks, summary({ visibleWeb: false, visiblePrint: false })).languages), ['both']);
  assert.deepEqual(names(landingProfile({ blocks }).languages), ['both', 'web']);
  const hidden = [blocks.at(-1)];
  assert.equal(letterResumeContext(hidden), null);
  assert.deepEqual(planOutline(hidden).outline, []);
  assert.equal(resumeOutline(hidden, summary()), null);
  assert.equal(landingProfile({ blocks: hidden }), null);
});

test('empty and malformed languages are dropped, and the rest is trimmed', () => {
  const entries = [{ language: '  ' }, { language: '', level: 'Native' }, 'Spanish', null, { level: 'B2' }, { language: ' French ', level: ' B2 ' }];
  const blocks = [languages(entries)];
  assert.deepEqual(letterResumeContext(blocks), { languages: [{ language: 'French', level: 'B2' }] });
  assert.deepEqual(planOutline(blocks).outline[0].languages, 'French (B2)');
  assert.deepEqual(resumeOutline(blocks, summary()), { languages: [{ language: 'French', level: 'B2' }] });
  assert.deepEqual(landingProfile({ blocks }), { languages: [{ language: 'French', level: 'B2' }] });
  const none = [languages([{ language: ' ' }, { level: 'Native' }])];
  assert.equal(letterResumeContext(none), null);
  assert.equal(resumeOutline(none, summary()), null);
  assert.equal(landingProfile({ blocks: none }), null);
});

test('a tailoring plan may hide a languages block by its ref', () => {
  const blocks = [languages([{ language: 'Spanish', level: 'Fluent' }])];
  const { refs } = planOutline(blocks);
  const plan = checkPlan(blocks, { explanation: '', hide: [{ ref: 'B1', reason: 'Less relevant' }] }, refs, { hide: true, order: false });
  assert.deepEqual(plan.hides.map((h) => [h.blockId, h.reason]), [['languages', 'Less relevant']]);
});
