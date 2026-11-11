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

test('quotes, experience, education and skills sections and meta lines are never a target', async () => {
  const page = {
    ...landing,
    sections: [
      ...landing.sections,
      { id: 'quotes', kind: 'quotes', title: 'Kind words', quotes: [{ text: 'Great to work with.', name: 'Ann', role: 'Manager', url: '' }] },
      { id: 'work', kind: 'experience', title: 'Recent work', resumeId: 'r1', count: 2, showDates: true },
      { id: 'school', kind: 'education', title: 'Education', resumeId: 'r1', count: 2, showDates: true },
      { id: 'skills', kind: 'skills', title: 'Skills', resumeId: 'r1' },
    ],
  };
  for (const target of [
    { kind: 'quote', sectionId: 'quotes', index: 0 },
    { kind: 'quotes', sectionId: 'quotes' },
    { kind: 'item', sectionId: 'quotes', index: 0 },
    { kind: 'text', sectionId: 'quotes' },
    { kind: 'experience', sectionId: 'work' },
    { kind: 'text', sectionId: 'work' },
    { kind: 'education', sectionId: 'school' },
    { kind: 'text', sectionId: 'school' },
    { kind: 'item', sectionId: 'school', index: 0 },
    { kind: 'answer', sectionId: 'school', index: 0 },
    { kind: 'skills', sectionId: 'skills' },
    { kind: 'text', sectionId: 'skills' },
    { kind: 'item', sectionId: 'skills', index: 0 },
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

test('a stats section is never a target, and the page context shows only the stats a visitor sees', async () => {
  const page = {
    ...landing,
    sections: [
      ...landing.sections,
      { id: 'nums', kind: 'stats', title: 'By the numbers', stats: [{ value: '15 years', label: 'in commercial kitchens' }, { value: ' ', label: 'Unshown label' }] },
    ],
  };
  for (const target of [
    { kind: 'stats', sectionId: 'nums' },
    { kind: 'stat', sectionId: 'nums', index: 0 },
    { kind: 'item', sectionId: 'nums', index: 0 },
    { kind: 'text', sectionId: 'nums' },
    { kind: 'intro', sectionId: 'nums' },
  ]) {
    assert.throws(() => normalizeLandingTarget(page, target), InvalidLandingTargetError, JSON.stringify(target));
  }
  const { user } = buildLandingPrompt(page, { kind: 'text', sectionId: 'intro' }, 'Shorter', null);
  for (const shown of ['By the numbers', '15 years', 'in commercial kitchens']) assert.ok(user.includes(shown), shown);
  assert.ok(!user.includes('Unshown label'));
});

test("a credential is never a target, and the page context shows the ones a visitor sees, without their numbers or links", () => {
  const page = {
    ...landing,
    sections: [
      ...landing.sections,
      {
        id: 'creds',
        kind: 'credentials',
        title: 'Licenses',
        credentials: [
          { kind: 'license', name: 'Registered Nurse', issuer: 'State Board', number: 'RN-0951', issued: '2019', expires: '2999', url: 'https://board.example/verify' },
          { kind: 'certification', name: 'Lapsed cert', issuer: 'Old Board', number: '', issued: '', expires: '1999', url: '' },
        ],
      },
    ],
  };
  for (const target of [
    { kind: 'credential', sectionId: 'creds', index: 0 },
    { kind: 'credentials', sectionId: 'creds' },
    { kind: 'item', sectionId: 'creds', index: 0 },
    { kind: 'text', sectionId: 'creds' },
  ]) {
    assert.throws(() => normalizeLandingTarget(page, target), InvalidLandingTargetError, JSON.stringify(target));
  }
  const { user } = buildLandingPrompt(page, { kind: 'text', sectionId: 'intro' }, 'Shorter', null, new Map());
  for (const shown of ['Licenses', 'Registered Nurse', 'State Board']) assert.ok(user.includes(shown), shown);
  for (const left of ['RN-0951', 'board.example', 'Lapsed cert', 'Old Board']) assert.ok(!user.includes(left), left);
});

test('a media section is never a target, and the page context gives it only its kind and title', () => {
  const page = {
    ...landing,
    sections: [
      ...landing.sections,
      { id: 'reel', kind: 'media', title: 'My reel', url: 'https://youtu.be/dQw4w9WgXcQ', caption: 'Spring showcase', transcript: 'Spoken words.' },
    ],
  };
  for (const target of [
    { kind: 'media', sectionId: 'reel' },
    { kind: 'text', sectionId: 'reel' },
    { kind: 'item', sectionId: 'reel', index: 0 },
  ]) {
    assert.throws(() => normalizeLandingTarget(page, target), InvalidLandingTargetError, JSON.stringify(target));
  }
  const { user } = buildLandingPrompt(page, { kind: 'text', sectionId: 'intro' }, 'Shorter', null, new Map());
  assert.ok(user.includes('My reel'));
  for (const left of ['youtu', 'dQw4w9WgXcQ', 'Spring showcase', 'Spoken words']) assert.ok(!user.includes(left), left);
});

test('a publication is never a target, and the page context shows the titled ones without their links or DOIs', () => {
  const entry = (title, extra = {}) => ({ kind: 'paper', title, outlet: '', date: '', url: '', doi: '', note: '', ...extra });
  const page = {
    ...landing,
    sections: [
      ...landing.sections,
      {
        id: 'pubs',
        kind: 'publications',
        title: 'Writing',
        order: 'manual',
        group: false,
        entries: [
          entry('Array programming', { outlet: 'Nature', date: 'Sep 2020', url: 'https://nature.example/a', doi: '10.1038/s41586-020-2649-2' }),
          entry(' ', { outlet: 'Untitled outlet' }),
        ],
      },
    ],
  };
  for (const target of [
    { kind: 'publication', sectionId: 'pubs', index: 0 },
    { kind: 'publications', sectionId: 'pubs' },
    { kind: 'item', sectionId: 'pubs', index: 0 },
    { kind: 'text', sectionId: 'pubs' },
  ]) {
    assert.throws(() => normalizeLandingTarget(page, target), InvalidLandingTargetError, JSON.stringify(target));
  }
  const { user } = buildLandingPrompt(page, { kind: 'text', sectionId: 'intro' }, 'Shorter', null, new Map());
  for (const shown of ['Writing', 'Array programming', 'Nature', 'Sep 2020']) assert.ok(user.includes(shown), shown);
  for (const left of ['nature.example', '10.1038', 'Untitled outlet']) assert.ok(!user.includes(left), left);
});

test('the page context leaves hidden sections out, and shows quotes, meta lines, roles, education and skills as a visitor reads them', () => {
  const page = {
    ...landing,
    sections: [
      { id: 'intro', kind: 'text', title: '', body: 'I build things.' },
      { id: 'now', kind: 'text', title: 'Now', body: 'Reading a secret book.', hidden: true },
      { id: 'proj', kind: 'items', title: 'Projects', items: [{ title: 'Widget', text: 'A widget.', url: '', meta: '2024 · Rust' }] },
      { id: 'quotes', kind: 'quotes', title: '', quotes: [{ text: 'Great to work with.', name: 'Ann', role: 'Manager', url: 'https://ann.example' }] },
      { id: 'work', kind: 'experience', title: 'Recent work', resumeId: 'r1', count: 1, showDates: true },
      { id: 'school', kind: 'education', title: 'Education', resumeId: 'r1', count: 1, showDates: false },
      { id: 'skills', kind: 'skills', title: 'Skills', resumeId: 'r1' },
    ],
  };
  const experience = [
    { jobTitle: 'SRE', company: 'Acme', companyUrl: 'https://acme.example', location: 'Remote', startDate: '2022', endDate: 'Present' },
    { jobTitle: 'Dev', company: 'Beta', companyUrl: '', location: '', startDate: '2019', endDate: '2022' },
  ];
  const education = [
    { degree: 'BSc Nursing', institution: 'State U', location: 'Ohio', startDate: '2010', endDate: '2014' },
    { degree: 'Diploma', institution: 'Second School', location: '', startDate: '', endDate: '' },
  ];
  const skills = [{ category: 'Languages', items: ['Spanish (fluent)', 'ASL'] }];
  const resumes = new Map([['r1', { href: '/r/eng', title: 'Engineer', experience, education, skills }]]);
  const { user } = buildLandingPrompt(page, { kind: 'text', sectionId: 'intro' }, 'Shorter', null, resumes);
  assert.ok(!user.includes('secret book'));
  for (const shown of ['2024 · Rust', 'Great to work with.', 'Ann', 'SRE', 'Acme', '2022 – Present', 'BSc Nursing', 'State U', 'Spanish (fluent)', 'Languages']) {
    assert.ok(user.includes(shown), shown);
  }
  for (const left of ['Beta', 'https://', '/r/eng', '"r1"', 'Second School', '2010 – 2014']) assert.ok(!user.includes(left), left);
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

test('an FAQ answer is a target by index, its question never is, and only that answer is written', async () => {
  const page = {
    ...landing,
    sections: [
      ...landing.sections,
      {
        id: 'faq',
        kind: 'faq',
        title: 'Questions',
        entries: [
          { question: 'Do you relocate?', answer: 'Yes, see [my notes](https://jo.example/move).\n\nWithin *Europe*.' },
          { question: 'When can you start?', answer: '' },
        ],
      },
      { id: 'secret', kind: 'faq', title: '', hidden: true, entries: [{ question: 'Salary?', answer: 'A lot.' }] },
    ],
  };
  const answer = { kind: 'answer', sectionId: 'faq', index: 0 };
  assert.deepEqual(normalizeLandingTarget(page, { ...answer, extra: 1 }), answer);
  assert.equal(landingSlice(page, { kind: 'answer', sectionId: 'faq', index: 1 }), '');
  assert.equal(landingSlice(page, { kind: 'answer', sectionId: 'faq', index: 2 }), null);
  for (const target of [
    { kind: 'answer', sectionId: 'faq', index: 2 },
    { kind: 'answer', sectionId: 'faq', index: '0' },
    { kind: 'answer', sectionId: 'faq' },
    { kind: 'answer', sectionId: 'proj', index: 0 },
    { kind: 'item', sectionId: 'faq', index: 0 },
    { kind: 'question', sectionId: 'faq', index: 0 },
    { kind: 'text', sectionId: 'faq' },
  ]) {
    assert.throws(() => normalizeLandingTarget(page, target), InvalidLandingTargetError, JSON.stringify(target));
  }

  // The answer's link is a placeholder, read as one paragraph; the question
  // is context the model is told not to change; a hidden FAQ isn't read.
  assert.deepEqual([...linkPlaceholders(page, answer)], [['https://jo.example/move', '#L1']]);
  const { system, user } = buildLandingPrompt(page, answer, 'Shorter', null);
  assert.match(system, /the question, which you don't change, is "Do you relocate\?"/);
  assert.match(system, /keep its #L target exactly as it is/);
  assert.ok(user.includes('"text": "Yes, see [my notes](#L1).\\n\\nWithin *Europe*."'));
  assert.ok(user.includes('"question": "When can you start?"'));
  assert.ok(user.includes('"answer": "[the part being rewritten]"'));
  for (const hidden of ['jo.example', 'Salary', 'A lot.']) assert.ok(!user.includes(hidden), hidden);
  // Another answer, outside the target, shows its link's label only.
  const second = buildLandingPrompt(page, { kind: 'answer', sectionId: 'faq', index: 1 }, 'Write one', null).user;
  assert.ok(second.includes('"answer": "Yes, see my notes.\\n\\nWithin *Europe*."'));

  const result = await rewriteLanding({
    landing: page,
    target: answer,
    instruction: 'Shorter',
    settings,
    callModel: async () => ({ explanation: 'Shorter.', rewrite: { text: 'Yes, within Europe: [details](#L1).' } }),
  });
  assert.deepEqual(result.proposals, [{ target: answer, before: page.sections[4].entries[0].answer, after: 'Yes, within Europe: [details](https://jo.example/move).' }]);

  // A link the answer didn't have is refused, as for any other target.
  for (const written of ['See [here](https://evil.example).', 'See [here](#L2).', 'Fine.\n\n[x](/r/secret)']) {
    assert.throws(() => landingProposals(page, answer, { text: written }), { status: 502, message: /added a link/ }, written);
  }
  // Its cap counts as the field's does.
  const escaped = `${'x'.repeat(LANDING_LIMITS.faqAnswer - 4)} \\*a\\*`;
  assert.equal(landingProposals(page, answer, { text: escaped })[0].after, escaped);
  assert.throws(() => landingProposals(page, answer, { text: `${escaped}x` }), { status: 502, message: /the answer allows/ });
});

test("a service's text is a target by index, its title, price and button never are, and only that text is written", async () => {
  const page = {
    ...landing,
    sections: [
      ...landing.sections,
      {
        id: 'sv',
        kind: 'services',
        title: 'Services',
        services: [
          {
            title: 'Tutoring',
            text: 'Weekly sessions, see [the syllabus](https://jo.example/syllabus).',
            price: 'From $60/hour',
            action: { type: 'link', label: 'Book a session', url: 'https://cal.example/jo' },
          },
          { title: 'Consultation', text: '', price: 'Free' },
        ],
      },
      { id: 'secret', kind: 'services', title: '', hidden: true, services: [{ title: 'Ghostwriting', text: 'Quietly.', price: '$9000' }] },
    ],
  };
  const service = { kind: 'service', sectionId: 'sv', index: 0 };
  assert.deepEqual(normalizeLandingTarget(page, { ...service, extra: 1 }), service);
  assert.equal(landingSlice(page, { kind: 'service', sectionId: 'sv', index: 1 }), '');
  assert.equal(landingSlice(page, { kind: 'service', sectionId: 'sv', index: 2 }), null);
  assert.equal(landingSlice(page, { kind: 'service', sectionId: 'proj', index: 0 }), null);
  for (const target of [
    { kind: 'service', sectionId: 'sv', index: 2 },
    { kind: 'service', sectionId: 'sv', index: '0' },
    { kind: 'service', sectionId: 'sv' },
    { kind: 'service', sectionId: 'proj', index: 0 },
    { kind: 'item', sectionId: 'sv', index: 0 },
    { kind: 'price', sectionId: 'sv', index: 0 },
    { kind: 'text', sectionId: 'sv' },
  ]) {
    assert.throws(() => normalizeLandingTarget(page, target), InvalidLandingTargetError, JSON.stringify(target));
  }
  // Its schema holds to the strict structured-output rules, like the others'.
  const rewrite = landingOutputSchema(service);
  for (const schema of [rewrite, rewrite.properties.rewrite]) {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
  }
  assert.deepEqual(Object.keys(landingOutputSchema(service).properties.rewrite.properties), ['text']);

  // The text's link is a placeholder; the title and price are facts the
  // model is told not to change; the button shows by its label, never its
  // link; a hidden section isn't read.
  assert.deepEqual([...linkPlaceholders(page, service)], [['https://jo.example/syllabus', '#L1']]);
  const { system, user } = buildLandingPrompt(page, service, 'Shorter', null);
  assert.match(system, /its name is "Tutoring" and its price is "From \$60\/hour", which you don't change/);
  assert.match(system, /keep its #L target exactly as it is/);
  assert.ok(user.includes('"text": "Weekly sessions, see [the syllabus](#L1)."'));
  assert.ok(user.includes('"button": "Book a session"'));
  assert.ok(user.includes('"price": "Free"'));
  assert.ok(user.includes('"text": "[the part being rewritten]"'));
  for (const hidden of ['cal.example', 'jo.example', 'Ghostwriting', '$9000']) assert.ok(!user.includes(hidden), hidden);
  // Another service, outside the target, shows its link's label only.
  const second = buildLandingPrompt(page, { kind: 'service', sectionId: 'sv', index: 1 }, 'Write one', null);
  assert.ok(second.user.includes('"text": "Weekly sessions, see the syllabus."'));
  assert.match(second.system, /its name is "Consultation" and its price is "Free"/);

  const result = await rewriteLanding({
    landing: page,
    target: service,
    instruction: 'Shorter',
    settings,
    // Whatever else the model sends back, only the text is read.
    callModel: async () => ({ explanation: 'Shorter.', rewrite: { text: 'Weekly, with [a syllabus](#L1).', title: 'Lessons', price: '$1' } }),
  });
  assert.deepEqual(result.proposals, [
    { target: service, before: page.sections[4].services[0].text, after: 'Weekly, with [a syllabus](https://jo.example/syllabus).' },
  ]);

  // A link the text didn't have is refused, as for any other target.
  for (const written of ['Book [here](https://evil.example).', 'See [here](#L2).', 'Fine.\n\n[x](/r/secret)', '[Book](https://cal.example/jo)']) {
    assert.throws(() => landingProposals(page, service, { text: written }), { status: 502, message: /added a link/ }, written);
  }
  // Its cap counts as the field's does.
  const escaped = `${'x'.repeat(LANDING_LIMITS.serviceText - 4)} \\*a\\*`;
  assert.equal(landingProposals(page, service, { text: escaped })[0].after, escaped);
  assert.throws(() => landingProposals(page, service, { text: `${escaped}x` }), { status: 502, message: /the service allows/ });
});
