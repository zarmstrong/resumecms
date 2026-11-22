import test from 'node:test';
import assert from 'node:assert/strict';
import { letterResumeContext } from './letterWriting.js';
import { planOutline } from './tailorPlan.js';
import { resumeOutline } from './brief.js';
import { landingProfile } from './landingRewrite.js';
import { mergeRewrite, normalizeTarget, rewriteInput } from './rewritableFields.js';
import { experienceRoles } from '../landingFields.js';
import { EXPERIENCE_DETAIL_KEYS } from '../experienceDetails.js';

// Marker values that must never reach an AI builder, plus the key names
// themselves, so a builder copying the key by name is caught too.
const MARKS = ['GS-0343-11', 'SALARY-MARK', 'SUPERVISOR-MARK', 'hoursPerWeek', 'contactSupervisor'];
const DETAILS = { hoursPerWeek: '40', grade: 'GS-0343-11', salary: 'SALARY-MARK', supervisor: 'SUPERVISOR-MARK', contactSupervisor: 'yes' };

const entry = (flags = {}, data = {}) => ({
  id: 'exp', type: 'experience', parentId: null, visibleWeb: true, visiblePrint: true,
  data: { jobTitle: 'Analyst', company: 'Agency', startDate: '2020', endDate: 'Current', tagline: 'Tells the truth.', description: 'Analysis work.', bullets: ['Wrote the report'], ...DETAILS, ...data },
  ...flags,
});
const summary = () => ({ id: 'summary', type: 'summary', data: {}, visibleWeb: true, visiblePrint: true });
const leaks = (value) => MARKS.filter((mark) => JSON.stringify(value).includes(mark));

test('the details list the test guards is the server\'s full list', () => {
  assert.deepEqual(Object.keys(DETAILS).sort(), [...EXPERIENCE_DETAIL_KEYS].sort());
});

test('no AI builder or the landing roles copy an experience entry\'s federal details', () => {
  const blocks = [entry()];
  const contexts = {
    letter: letterResumeContext(blocks),
    plan: planOutline(blocks).outline,
    outline: resumeOutline(blocks, summary()),
    outlineWithAccomplishments: resumeOutline(blocks, summary(), { accomplishments: true }),
    landingProfile: landingProfile({ blocks }),
    landingRoles: experienceRoles(blocks),
  };
  for (const [name, context] of Object.entries(contexts)) {
    assert.deepEqual(leaks(context), [], name);
    assert.ok(JSON.stringify(context).includes('Analyst'), `${name} keeps the job title`);
  }
});

test('no rewrite input for an experience block carries the federal details', () => {
  const data = entry().data;
  for (const target of [{ kind: 'block' }, { kind: 'description' }, { kind: 'bullet', path: [0] }]) {
    const { editable, context } = rewriteInput('experience', data, normalizeTarget('experience', data, target));
    assert.deepEqual(leaks({ editable, context }), [], target.kind);
  }
  const { context } = rewriteInput('experience', data, normalizeTarget('experience', data, { kind: 'block' }));
  assert.ok(JSON.stringify(context).includes('Analyst'));
});

test('a rewrite of an experience block keeps the details and both visibility flags unchanged', () => {
  const data = { ...entry().data, tagline: 'Tells the truth.', detailsVisibleWeb: false, detailsVisiblePrint: true };
  const rewrite = { tagline: 'Tells the whole truth.', bullets: [{ text: 'Wrote the full report', children: [] }] };
  const { data: merged } = mergeRewrite('experience', data, rewrite);
  for (const key of [...EXPERIENCE_DETAIL_KEYS, 'detailsVisibleWeb', 'detailsVisiblePrint']) {
    assert.equal(merged[key], data[key], key);
  }
  assert.equal(merged.tagline, 'Tells the whole truth.');
});
