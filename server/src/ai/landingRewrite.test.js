import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLandingPrompt,
  landingOutputSchema,
  landingProfile,
  landingProposals,
  landingSlice,
  normalizeLandingTarget,
  rewriteLanding,
  InvalidLandingTargetError,
} from './landingRewrite.js';
import { LANDING_LIMITS } from '../landingFields.js';

const landing = {
  headline: 'Jo Doe',
  subheadline: 'Engineer',
  photo: 'custom',
  photoUrl: 'data:image/jpeg;base64,AAAA',
  sections: [
    { id: 'intro', kind: 'text', title: '', body: 'I build things.' },
    { id: 'proj', kind: 'items', title: 'Projects', items: [{ title: 'Widget', text: 'A widget.', url: 'https://w.example' }, { title: 'Gadget', text: '', url: '' }] },
    { id: 'links', kind: 'links', title: '', links: [{ label: 'GitHub', url: 'https://github.com/jo' }] },
    { id: 'cards', kind: 'resumes', title: '', cards: [{ resumeId: 'r1', label: 'Engineering', blurb: 'My engineering resume.' }] },
  ],
};

const settings = { provider: 'openai', apiKeys: { openai: 'sk' }, models: { openai: 'gpt' }, timeoutSeconds: 30 };

test('normalizeLandingTarget accepts each kind and keeps only its fields', () => {
  assert.deepEqual(normalizeLandingTarget(landing, { kind: 'headline', extra: 1 }), { kind: 'headline' });
  assert.deepEqual(normalizeLandingTarget(landing, { kind: 'text', sectionId: 'intro' }), { kind: 'text', sectionId: 'intro' });
  assert.deepEqual(normalizeLandingTarget(landing, { kind: 'intro', sectionId: 'intro' }), { kind: 'intro', sectionId: 'intro' });
  assert.deepEqual(normalizeLandingTarget(landing, { kind: 'item', sectionId: 'proj', index: 1 }), { kind: 'item', sectionId: 'proj', index: 1 });
  assert.deepEqual(normalizeLandingTarget(landing, { kind: 'card', sectionId: 'cards', resumeId: 'r1' }), {
    kind: 'card',
    sectionId: 'cards',
    resumeId: 'r1',
  });
});

test('normalizeLandingTarget refuses what is not on the page', () => {
  for (const target of [
    null,
    { kind: 'photo' },
    { kind: 'text' },
    { kind: 'text', sectionId: 'gone' },
    { kind: 'text', sectionId: 'proj' },
    { kind: 'intro', sectionId: 'links' },
    { kind: 'item', sectionId: 'proj', index: 2 },
    { kind: 'item', sectionId: 'proj', index: '0' },
    { kind: 'card', sectionId: 'cards', resumeId: 'r2' },
  ]) {
    assert.throws(() => normalizeLandingTarget(landing, target), InvalidLandingTargetError, JSON.stringify(target));
  }
});

test('landingSlice reads the text a target points at', () => {
  assert.equal(landingSlice(landing, { kind: 'subheadline' }), 'Engineer');
  assert.equal(landingSlice(landing, { kind: 'text', sectionId: 'intro' }), 'I build things.');
  assert.equal(landingSlice(landing, { kind: 'item', sectionId: 'proj', index: 0 }), 'A widget.');
  assert.equal(landingSlice(landing, { kind: 'card', sectionId: 'cards', resumeId: 'r1' }), 'My engineering resume.');
  assert.equal(landingSlice(landing, { kind: 'item', sectionId: 'proj', index: 5 }), null);
});

test('output schemas satisfy strict structured-output rules', () => {
  function check(schema, path) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false, path);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), path);
      for (const [k, v] of Object.entries(schema.properties)) check(v, `${path}.${k}`);
    }
    if (schema.type === 'array') check(schema.items, `${path}[]`);
  }
  check(landingOutputSchema({ kind: 'headline' }), 'headline');
  check(landingOutputSchema({ kind: 'intro', sectionId: 'intro' }), 'intro');
  assert.deepEqual(Object.keys(landingOutputSchema({ kind: 'intro', sectionId: 'intro' }).properties.rewrite.properties), [
    'headline',
    'subheadline',
    'intro',
  ]);
});

test('landingProfile reads only the published, web-visible outline', () => {
  const profile = landingProfile({
    header: { name: 'Jo', title: 'Engineer', email: 'jo@example.com', phone: '555' },
    blocks: [
      { type: 'summary', visibleWeb: true, data: { text: 'Ten years of platform work.' } },
      { type: 'experience', visibleWeb: true, data: { jobTitle: 'SRE', company: 'Acme', startDate: '2020', endDate: 'Current', bullets: [{ text: 'secret bullet' }] } },
      { type: 'experience', visibleWeb: false, data: { jobTitle: 'Hidden job', company: 'Nope' } },
      { type: 'skills_group', visibleWeb: true, data: { category: 'Lang', items: 'Go, Rust' } },
      { type: 'education', data: { degree: 'BSc', institution: 'Uni' } },
      { type: 'custom', visibleWeb: true, data: { title: 'Other' } },
    ],
  });
  assert.deepEqual(profile, {
    name: 'Jo',
    title: 'Engineer',
    summary: 'Ten years of platform work.',
    experience: [{ jobTitle: 'SRE', company: 'Acme', dates: '2020 – Current' }],
    skills: [{ category: 'Lang', items: 'Go, Rust' }],
    education: [{ degree: 'BSc', institution: 'Uni' }],
  });
  assert.equal(landingProfile(null), null);
  assert.equal(landingProfile({ header: {}, blocks: [] }), null);
});

test("landingProfile reads a web-visible executive summary's headline, overview and highlights", () => {
  const profile = landingProfile({
    header: {},
    blocks: [
      { type: 'summary', visibleWeb: true, data: { text: 'Plain summary.' } },
      { type: 'executive_summary', visibleWeb: true, data: { headline: 'Platform leader', text: 'Builds teams.', highlights: ['Grew the team', ' ', null] } },
      { type: 'executive_summary', visibleWeb: false, data: { headline: 'Print only', highlights: ['Secret'] } },
    ],
  });
  assert.deepEqual(profile, { summary: 'Plain summary.\n\nPlatform leader\n\nBuilds teams.', highlights: ['Grew the team'] });
});

test('the prompt marks the target, and leaves out URLs, ids and the photo', () => {
  const { system, user } = buildLandingPrompt(landing, { kind: 'item', sectionId: 'proj', index: 0 }, 'Shorter', null);
  assert.match(user, /\[the part being rewritten\]/);
  assert.match(user, /"text": "A widget\."/);
  assert.match(system, /its title, which you don't change, is "Widget"/);
  assert.match(system, new RegExp(`At most ${LANDING_LIMITS.itemText} characters`));
  for (const hidden of ['https://', 'data:image', 'r1', '"proj"', '"intro"']) assert.ok(!user.includes(hidden), hidden);
  assert.ok(!/resume profile/i.test(user));
});

test('an intro prompt marks all three spots and includes the profile', () => {
  const { system, user } = buildLandingPrompt(landing, { kind: 'intro', sectionId: 'intro' }, 'Write it', { name: 'Jo' });
  const context = user.slice(user.indexOf('The rest of the page'), user.indexOf('Section to rewrite'));
  assert.equal(context.match(/\[the part being rewritten\]/g).length, 3);
  assert.match(user, /^Resume profile \(read-only\):/);
  assert.match(system, /person's own resume/);
});

test('landingProposals returns one proposal per changed field', () => {
  const intro = { kind: 'intro', sectionId: 'intro' };
  assert.deepEqual(landingProposals(landing, intro, { headline: ' Jo Doe ', subheadline: 'Platform engineer', intro: 'Hi, I am Jo.' }), [
    { target: { kind: 'subheadline' }, before: 'Engineer', after: 'Platform engineer' },
    { target: { kind: 'text', sectionId: 'intro' }, before: 'I build things.', after: 'Hi, I am Jo.' },
  ]);
  assert.deepEqual(landingProposals(landing, { kind: 'headline' }, { text: 'Jo Doe' }), []);
});

test('landingProposals refuses a malformed or oversized answer', () => {
  assert.throws(() => landingProposals(landing, { kind: 'headline' }, null), { status: 502 });
  assert.throws(() => landingProposals(landing, { kind: 'headline' }, { text: 1 }), { status: 502 });
  assert.throws(() => landingProposals(landing, { kind: 'headline' }, { text: 'x'.repeat(LANDING_LIMITS.headline + 1) }), {
    status: 502,
    message: /more than the 120 characters the headline allows/,
  });
});

test('rewriteLanding calls the model with the schema and returns proposals', async () => {
  let seen;
  const result = await rewriteLanding({
    landing,
    target: { kind: 'card', sectionId: 'cards', resumeId: 'r1' },
    instruction: 'Punchier',
    settings,
    profile: { title: 'SRE' },
    callModel: async (request) => {
      seen = request;
      return { explanation: ' Tightened it. ', rewrite: { text: 'Platform and reliability work.' } };
    },
  });
  assert.equal(seen.model, 'gpt');
  assert.deepEqual(Object.keys(seen.schema.properties.rewrite.properties), ['text']);
  assert.match(seen.system, /this card links to/);
  assert.deepEqual(result, {
    target: { kind: 'card', sectionId: 'cards', resumeId: 'r1' },
    proposals: [
      { target: { kind: 'card', sectionId: 'cards', resumeId: 'r1' }, before: 'My engineering resume.', after: 'Platform and reliability work.' },
    ],
    explanation: 'Tightened it.',
  });
});

test('rewriteLanding needs an instruction except for an intro, and a valid target', async () => {
  const callModel = async () => ({ explanation: '', rewrite: { headline: 'Jo', subheadline: 'SRE', intro: 'Hi.' } });
  await assert.rejects(rewriteLanding({ landing, target: { kind: 'headline' }, instruction: '', settings, callModel }), { status: 400 });
  await assert.rejects(rewriteLanding({ landing, target: { kind: 'text', sectionId: 'x' }, instruction: 'a', settings, callModel }), {
    status: 400,
  });
  const { proposals } = await rewriteLanding({ landing, target: { kind: 'intro', sectionId: 'intro' }, instruction: '', settings, callModel });
  assert.equal(proposals.length, 3);
});
