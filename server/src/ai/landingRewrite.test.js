import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLandingPrompt,
  landingOutputSchema,
  landingProfile,
  landingProposals,
  landingSlice,
  linkPlaceholders,
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
  availability: 'Open to SRE roles',
  actions: [
    { type: 'link', label: 'Email me', url: 'mailto:jo@example.com' },
    { type: 'resume', label: 'Get the PDF', resumeId: 'r1', open: 'pdf' },
  ],
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
  for (const hidden of ['https://', 'mailto:', 'data:image', 'r1', '"proj"', '"intro"']) assert.ok(!user.includes(hidden), hidden);
  // The buttons and availability line are part of what a visitor reads.
  for (const shown of ['Open to SRE roles', 'Email me', 'Get the PDF']) assert.ok(user.includes(shown), shown);
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
  // Text that holds the syntax counts as its cap does, without escaping backslashes.
  const escaped = `${'x'.repeat(LANDING_LIMITS.itemText - 4)} \\*a\\*`;
  assert.equal(landingProposals(landing, { kind: 'item', sectionId: 'proj', index: 0 }, { text: escaped })[0].after, escaped);
  assert.throws(() => landingProposals(landing, { kind: 'item', sectionId: 'proj', index: 0 }, { text: `${escaped}x` }), { status: 502 });
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

test('quotes, experience sections and meta lines are never a target', async () => {
  const page = {
    ...landing,
    sections: [
      ...landing.sections,
      { id: 'quotes', kind: 'quotes', title: 'Kind words', quotes: [{ text: 'Great to work with.', name: 'Ann', role: 'Manager', url: '' }] },
      { id: 'work', kind: 'experience', title: 'Recent work', resumeId: 'r1', count: 2, showDates: true },
    ],
  };
  for (const target of [
    { kind: 'quote', sectionId: 'quotes', index: 0 },
    { kind: 'quotes', sectionId: 'quotes' },
    { kind: 'item', sectionId: 'quotes', index: 0 },
    { kind: 'text', sectionId: 'quotes' },
    { kind: 'experience', sectionId: 'work' },
    { kind: 'text', sectionId: 'work' },
    { kind: 'meta', sectionId: 'proj', index: 0 },
  ]) {
    assert.throws(() => normalizeLandingTarget(page, target), InvalidLandingTargetError, JSON.stringify(target));
  }
  let called = false;
  const callModel = async () => {
    called = true;
    return { explanation: '', rewrite: { text: 'Rewritten' } };
  };
  const target = { kind: 'quote', sectionId: 'quotes', index: 0 };
  await assert.rejects(rewriteLanding({ landing: page, target, instruction: 'Punchier', settings, callModel }), { status: 400 });
  assert.equal(called, false);
});

test('the page context leaves hidden sections out, and shows quotes, meta lines and roles as a visitor reads them', () => {
  const page = {
    ...landing,
    sections: [
      { id: 'intro', kind: 'text', title: '', body: 'I build things.' },
      { id: 'now', kind: 'text', title: 'Now', body: 'Reading a secret book.', hidden: true },
      { id: 'proj', kind: 'items', title: 'Projects', items: [{ title: 'Widget', text: 'A widget.', url: '', meta: '2024 · Rust' }] },
      { id: 'quotes', kind: 'quotes', title: '', quotes: [{ text: 'Great to work with.', name: 'Ann', role: 'Manager', url: 'https://ann.example' }] },
      { id: 'work', kind: 'experience', title: 'Recent work', resumeId: 'r1', count: 1, showDates: true },
    ],
  };
  const experience = [
    { jobTitle: 'SRE', company: 'Acme', companyUrl: 'https://acme.example', location: 'Remote', startDate: '2022', endDate: 'Present' },
    { jobTitle: 'Dev', company: 'Beta', companyUrl: '', location: '', startDate: '2019', endDate: '2022' },
  ];
  const resumes = new Map([['r1', { href: '/r/eng', title: 'Engineer', experience }]]);
  const { user } = buildLandingPrompt(page, { kind: 'text', sectionId: 'intro' }, 'Shorter', null, resumes);
  assert.ok(!user.includes('secret book'));
  for (const shown of ['2024 · Rust', 'Great to work with.', 'Ann', 'SRE', 'Acme', '2022 – Present']) assert.ok(user.includes(shown), shown);
  for (const left of ['Beta', 'https://', '/r/eng', '"r1"']) assert.ok(!user.includes(left), left);
  // A hidden section the target is in stays, so its spot is marked.
  const inHidden = buildLandingPrompt(page, { kind: 'text', sectionId: 'now' }, 'Shorter', null, resumes).user;
  const context = inHidden.slice(inHidden.indexOf('The rest of the page'), inHidden.indexOf('Section to rewrite'));
  assert.match(context, /"title": "Now"/);
  assert.match(context, /\[the part being rewritten\]/);
});

test('links reach the model as placeholders, the rest of the page as labels, and come back as they were', () => {
  const linked = {
    ...landing,
    sections: [
      { id: 'intro', kind: 'text', title: '', body: 'I write at [my blog](https://jo.example/blog).\n\nAlso [here](https://jo.example/blog) and [mail me](mailto:jo@example.com).' },
      { id: 'proj', kind: 'items', title: 'Projects', items: [{ title: 'Widget', text: 'Built for [Acme](https://acme.example/(x)).', url: '' }] },
    ],
  };
  const text = { kind: 'text', sectionId: 'intro' };
  assert.deepEqual([...linkPlaceholders(linked, text)], [
    ['https://jo.example/blog', '#L1'],
    ['mailto:jo@example.com', '#L2'],
  ]);
  const { system, user } = buildLandingPrompt(linked, text, 'Shorter', null);
  assert.match(system, /keep its #L target exactly as it is/);
  assert.ok(user.includes('I write at [my blog](#L1).\\n\\nAlso [here](#L1) and [mail me](#L2).'));
  // The item, outside the target, shows its link's label only.
  assert.ok(user.includes('"text": "Built for Acme."'));
  for (const hidden of ['jo.example', 'mailto:', 'acme.example']) assert.ok(!user.includes(hidden), hidden);

  // Labels reworded, links moved, one dropped: the URLs come back.
  assert.deepEqual(landingProposals(linked, text, { text: 'Read [the blog](#L1), or **[write](#L2)**.' }), [
    { target: text, before: linked.sections[0].body, after: 'Read [the blog](https://jo.example/blog), or **[write](mailto:jo@example.com)**.' },
  ]);
  const item = { kind: 'item', sectionId: 'proj', index: 0 };
  assert.ok(buildLandingPrompt(linked, item, 'x', null).user.includes('"text": "Built for [Acme](#L1)."'));
  assert.equal(landingProposals(linked, item, { text: 'Made for [Acme](#L1).' })[0].after, 'Made for [Acme](https://acme.example/(x)).');
  // An intro masks only its text section; the headline is plain text.
  const intro = { kind: 'intro', sectionId: 'intro' };
  assert.ok(buildLandingPrompt(linked, intro, 'x', null).user.includes('"intro": "I write at [my blog](#L1).'));
  assert.equal(
    landingProposals(linked, intro, { headline: 'Jo', subheadline: 'Engineer', intro: 'At [my blog](#L1).' }).at(-1).after,
    'At [my blog](https://jo.example/blog).'
  );
});

test('an answer that links anywhere but its placeholders is refused', () => {
  const linked = { ...landing, sections: [{ id: 'intro', kind: 'text', title: '', body: 'See [my blog](https://jo.example).' }, landing.sections[1]] };
  const text = { kind: 'text', sectionId: 'intro' };
  for (const answer of [
    'See [my blog](https://evil.example).',
    'See [my blog](#L1) and [this](#L2).',
    'See [x](javascript:alert(1)).',
    'Fine.\n\nThen [a page](/r/secret).',
  ]) {
    assert.throws(() => landingProposals(linked, text, { text: answer }), { status: 502, message: /added a link/ }, answer);
  }
  // With no links in the field, any link is made up, in an item too.
  assert.throws(() => landingProposals(landing, { kind: 'item', sectionId: 'proj', index: 0 }, { text: '[Widget](#L1)' }), { status: 502 });
  assert.throws(
    () => landingProposals(landing, { kind: 'intro', sectionId: 'intro' }, { headline: 'Jo', subheadline: 'SRE', intro: 'Hi at [blog](https://jo.example).' }),
    { status: 502 }
  );
  // Text that only looks like a link, and emphasis, are fine; a headline is plain text, never a link.
  assert.equal(
    landingProposals(linked, text, { text: '**See** \\[x](https://evil.example) [my blog](#L1).' })[0].after,
    '**See** \\[x](https://evil.example) [my blog](https://jo.example).'
  );
  assert.equal(landingProposals(landing, { kind: 'headline' }, { text: '[Jo](https://evil.example)' })[0].after, '[Jo](https://evil.example)');
});
