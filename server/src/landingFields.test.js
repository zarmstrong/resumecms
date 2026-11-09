import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDING_LIMITS,
  referencedResumeIds,
  emptyLanding,
  initialLanding,
  isSafeUrl,
  mergeLandingPatch,
  resolveLanding,
  telUrl,
  upgradeLanding,
  validateLanding,
} from './landingFields.js';

const known = (...ids) => ({ knownResumeIds: new Set(ids) });
const linksSection = (links) => ({ sections: [{ id: 'l', kind: 'links', links }] });
const cardsSection = (cards, id = 'c') => ({ id, kind: 'resumes', cards });
const status = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

test('validateLanding fills missing fields and returns only known ones', () => {
  assert.deepEqual(validateLanding({}, known()), emptyLanding());
  const out = validateLanding({ headline: 'Jo', ...linksSection([{ label: 'gh', url: 'https://github.com/jo' }]) }, known());
  assert.equal(out.headline, 'Jo');
  assert.deepEqual(out.sections, [{ id: 'l', kind: 'links', title: '', links: [{ label: 'gh', url: 'https://github.com/jo' }] }]);
  // Every kind gets its own fields, filled in.
  const kinds = validateLanding(
    { sections: [{ kind: 'text', id: 't' }, { kind: 'items', id: 'i', items: [{ title: 'P' }] }, { kind: 'resumes', id: 'r' }] },
    known()
  ).sections;
  assert.deepEqual(kinds, [
    { id: 't', kind: 'text', title: '', body: '' },
    { id: 'i', kind: 'items', title: '', items: [{ title: 'P', text: '', url: '' }] },
    { id: 'r', kind: 'resumes', title: '', cards: [] },
  ]);
  // A section sent without an id (as an MCP client might) gets one.
  const [added] = validateLanding({ sections: [{ kind: 'text', body: 'x' }] }, known()).sections;
  assert.match(added.id, /^[A-Za-z0-9_-]{1,64}$/);
});

test('validateLanding rejects unknown keys, wrong types and oversized values', () => {
  assert.equal(status(() => validateLanding(null, known())), 400);
  assert.equal(status(() => validateLanding([], known())), 400);
  assert.equal(status(() => validateLanding({ headlines: 'x' }, known())), 400);
  assert.equal(status(() => validateLanding({ headline: 5 }, known())), 400);
  assert.equal(status(() => validateLanding({ headline: 'x'.repeat(LANDING_LIMITS.headline + 1) }, known())), 400);
  // The fields from before sections are unknown now.
  assert.equal(status(() => validateLanding({ intro: 'x' }, known())), 400);
  assert.equal(status(() => validateLanding({ links: [] }, known())), 400);
  assert.equal(status(() => validateLanding(linksSection({}), known())), 400);
  assert.equal(status(() => validateLanding(linksSection([{ label: 'a', url: 'https://a', extra: 1 }]), known())), 400);
  assert.equal(status(() => validateLanding(linksSection([{ type: 'myspace', label: 'a', url: 'https://a' }]), known())), 400);
  const tooMany = Array.from({ length: LANDING_LIMITS.links + 1 }, () => ({ label: 'a', url: 'https://a' }));
  assert.equal(status(() => validateLanding(linksSection(tooMany), known())), 400);
  assert.equal(status(() => validateLanding({ photo: 'gravatar' }, known())), 400);

  const section = (extra) => validateLanding({ sections: [{ id: 's', ...extra }] }, known());
  assert.equal(status(() => validateLanding({ sections: {} }, known())), 400);
  assert.equal(status(() => validateLanding({ sections: ['text'] }, known())), 400);
  assert.equal(status(() => section({ kind: 'html', body: '<b>' })), 400);
  assert.equal(status(() => section({ kind: '__proto__' })), 400);
  // A field of another kind is unknown, not ignored.
  assert.equal(status(() => section({ kind: 'text', body: 'x', links: [] })), 400);
  assert.equal(status(() => section({ kind: 'text', body: 5 })), 400);
  assert.equal(status(() => section({ kind: 'text', title: 'x'.repeat(LANDING_LIMITS.sectionTitle + 1) })), 400);
  assert.equal(status(() => section({ kind: 'text', body: 'x'.repeat(LANDING_LIMITS.text + 1) })), 400);
  assert.equal(status(() => section({ kind: 'items', items: [{ title: 'a', image: 'x' }] })), 400);
  assert.equal(status(() => section({ kind: 'items', items: [{ text: 'x'.repeat(LANDING_LIMITS.itemText + 1) }] })), 400);
  assert.equal(status(() => section({ kind: 'items', items: Array.from({ length: LANDING_LIMITS.items + 1 }, () => ({})) })), 400);
  for (const id of ['', 'has space', 'a/b', 'x'.repeat(65), 5]) {
    assert.equal(status(() => section({ kind: 'text', id })), 400, String(id));
  }
  const twice = { sections: [{ id: 'a', kind: 'text' }, { id: 'a', kind: 'links' }] };
  assert.equal(status(() => validateLanding(twice, known())), 400);
  const tooManySections = Array.from({ length: LANDING_LIMITS.sections + 1 }, (_, i) => ({ id: `s${i}`, kind: 'text' }));
  assert.equal(status(() => validateLanding({ sections: tooManySections }, known())), 400);
});

test('link URLs may not use a script-running scheme, however it is spelled', () => {
  for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:x', 'data:text/html,<script>x</script>', 'vbscript:x', 'sms:123']) {
    assert.equal(isSafeUrl(url), false, url);
    assert.equal(status(() => validateLanding(linksSection([{ label: 'a', url }]), known())), 400, url);
    const item = { sections: [{ id: 'i', kind: 'items', items: [{ title: 'a', url }] }] };
    assert.equal(status(() => validateLanding(item, known())), 400, url);
  }
  // A half-typed or relative URL resolves against the page, like an href.
  for (const url of ['', 'h', 'https:', 'https://example.com', 'mailto:me@example.com', 'tel:+15555550100', 'TEL:555', 'example.com/me', '//example.com']) {
    assert.equal(isSafeUrl(url), true, url);
  }
  // One the parser rejects (half typed) saves, but is never shown.
  for (const url of ['https://', 'http://[']) {
    const draft = validateLanding(
      { sections: [{ id: 'l', kind: 'links', links: [{ label: 'x', url }] }, { id: 'i', kind: 'items', items: [{ title: 'P', url }] }] },
      known()
    );
    assert.equal(draft.sections[0].links[0].url, url);
    // The link section has nothing left to show; the item stays, unlinked.
    assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).sections, [
      { kind: 'items', title: '', items: [{ title: 'P', text: '', url: '' }] },
    ]);
  }
});

test('email and phone links save, show and keep their type', () => {
  const links = [
    { type: 'email', label: 'jo@example.com', url: 'mailto:jo@example.com' },
    { type: 'phone', label: '+1 555 555 0100', url: 'tel:+15555550100' },
  ];
  const draft = validateLanding(
    { sections: [{ id: 'l', kind: 'links', links }, { id: 'i', kind: 'items', items: [{ title: 'Call', url: 'tel:+15555550100' }] }] },
    known()
  );
  assert.deepEqual(draft.sections[0].links, links);
  assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).sections, [
    { kind: 'links', title: '', links },
    { kind: 'items', title: '', items: [{ title: 'Call', text: '', url: 'tel:+15555550100' }] },
  ]);
  assert.equal(status(() => validateLanding(linksSection([{ type: 'fax', label: 'a', url: 'tel:1' }]), known())), 400);
});

test('telUrl dials the digits of a number as typed, with its extension', () => {
  assert.equal(telUrl('+1 (555) 555-0100'), 'tel:+15555550100');
  assert.equal(telUrl('555.555.0100'), 'tel:5555550100');
  assert.equal(telUrl('+44 20 7946 0958 ext. 12'), 'tel:+442079460958;ext=12');
  assert.equal(telUrl('555-0100 x7'), 'tel:5550100;ext=7');
  for (const phone of ['', '   ', '+', 'call me', null, undefined, 5]) assert.equal(telUrl(phone), '', String(phone));
  // The header's phone isn't validated: a long run of spaces mustn't stall it.
  const start = Date.now();
  for (const phone of [`${' '.repeat(20000)}a`, `${'x '.repeat(10000)}a`, `#${' '.repeat(20000)}a`]) assert.equal(telUrl(phone), '');
  assert.ok(Date.now() - start < 500);
});

test('photoUrl must be an inline JPEG, PNG or WebP image', () => {
  assert.equal(validateLanding({ photoUrl: 'data:image/jpeg;base64,/9j/4AAQ==' }, known()).photoUrl, 'data:image/jpeg;base64,/9j/4AAQ==');
  for (const photoUrl of [
    'https://tracker.example/pixel.gif',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,abc"onerror="x',
    'javascript:alert(1)',
  ]) {
    assert.equal(status(() => validateLanding({ photoUrl }, known())), 400, photoUrl);
  }
  const huge = `data:image/jpeg;base64,${'A'.repeat(LANDING_LIMITS.photoUrl)}`;
  assert.equal(status(() => validateLanding({ photoUrl: huge }, known())), 400);
});

test('a new card must name an existing resume; one already in the draft may outlive it', () => {
  const cards = (list) => ({ sections: [cardsSection(list)] });
  assert.deepEqual(validateLanding(cards([{ resumeId: 'a' }]), known('a')).sections[0].cards, [{ resumeId: 'a', label: '', blurb: '', showPdf: false }]);
  assert.equal(status(() => validateLanding(cards([{ resumeId: 'gone' }]), known('a'))), 400);
  const kept = validateLanding(cards([{ resumeId: 'gone' }]), { knownResumeIds: new Set(['a']), previousResumeIds: new Set(['gone']) });
  assert.equal(kept.sections[0].cards[0].resumeId, 'gone');
  assert.equal(status(() => validateLanding(cards([{ resumeId: 'a' }, { resumeId: 'a' }]), known('a'))), 400);
  assert.equal(status(() => validateLanding(cards([{ label: 'x' }]), known('a'))), 400);
  // Two sections may each have a card for the same resume.
  const both = validateLanding({ sections: [cardsSection([{ resumeId: 'a' }], 'c1'), cardsSection([{ resumeId: 'a' }], 'c2')] }, known('a'));
  assert.deepEqual([...referencedResumeIds(both)], ['a']);
});

test('mergeLandingPatch replaces fields, resets null ones, and ignores __proto__', () => {
  const current = { ...emptyLanding(), headline: 'A', subheadline: 'B' };
  const merged = mergeLandingPatch(current, JSON.parse('{"headline":"C","subheadline":null,"__proto__":{"polluted":true}}'));
  assert.equal(merged.headline, 'C');
  assert.equal('subheadline' in merged, false);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  assert.equal(validateLanding(merged, known()).subheadline, '');
});

test('seo is checked strictly, filled in, merged one level deep and shown whole', () => {
  assert.deepEqual(validateLanding({}, known()).seo, { title: '', description: '', noindex: false });
  const seo = { title: 'Jo Doe', description: 'Engineer', noindex: true };
  assert.deepEqual(validateLanding({ seo }, known()).seo, seo);
  assert.equal(status(() => validateLanding({ seo: { image: 'x' } }, known())), 400);
  assert.equal(status(() => validateLanding({ seo: 'Jo' }, known())), 400);
  assert.equal(status(() => validateLanding({ seo: { noindex: 'yes' } }, known())), 400);
  assert.equal(status(() => validateLanding({ seo: { title: 7 } }, known())), 400);
  assert.equal(status(() => validateLanding({ seo: { title: 'x'.repeat(LANDING_LIMITS.seoTitle + 1) } }, known())), 400);
  assert.equal(status(() => validateLanding({ seo: { description: 'x'.repeat(LANDING_LIMITS.seoDescription + 1) } }, known())), 400);
  assert.equal(validateLanding({ seo: { title: 'x'.repeat(LANDING_LIMITS.seoTitle) } }, known()).seo.title.length, LANDING_LIMITS.seoTitle);

  // The MCP merge keeps the title when only the description is sent, and
  // a null resets one field.
  const merged = mergeLandingPatch({ ...emptyLanding(), seo }, { seo: { description: 'New', noindex: null } });
  assert.deepEqual(validateLanding(merged, known()).seo, { title: 'Jo Doe', description: 'New', noindex: false });
  assert.deepEqual(validateLanding(mergeLandingPatch({ ...emptyLanding(), seo }, { seo: null }), known()).seo, emptyLanding().seo);

  const context = { photoUrl: '', site: null, resumes: new Map() };
  assert.deepEqual(resolveLanding({ ...emptyLanding(), seo }, context).seo, seo);
  // A draft stored before seo reads with the empty one.
  const { seo: _, ...old } = emptyLanding();
  assert.deepEqual(upgradeLanding(old).seo, emptyLanding().seo);
});

test('a draft stored before sections reads as the sections it showed, in order', () => {
  const old = {
    headline: 'Jo',
    subheadline: 'Engineer',
    intro: 'Hi',
    photo: 'resume',
    photoUrl: '',
    links: [{ label: 'gh', url: 'https://github.com/jo' }],
    resumes: [{ resumeId: 'main', label: '', blurb: '' }],
    publishedAt: '2026-11-06T00:00:00.000Z',
  };
  const upgraded = upgradeLanding(old);
  assert.deepEqual(upgraded, {
    headline: 'Jo',
    subheadline: 'Engineer',
    availability: '',
    actions: [],
    photo: 'resume',
    photoUrl: '',
    publishedAt: '2026-11-06T00:00:00.000Z',
    sections: [
      { id: 'intro', kind: 'text', title: '', body: 'Hi' },
      { id: 'links', kind: 'links', title: '', links: old.links },
      { id: 'resumes', kind: 'resumes', title: '', cards: [{ ...old.resumes[0], showPdf: false }] },
    ],
    seo: { title: '', description: '', noindex: false },
    homeLink: true,
    homeLinkLabel: '',
  });
  // Stable, and the new shape (or nothing) passes through untouched.
  assert.deepEqual(upgradeLanding(old), upgraded);
  assert.equal(upgradeLanding(upgraded), upgraded);
  assert.equal(upgradeLanding(null), null);
  // Empty fields don't become empty sections.
  assert.deepEqual(upgradeLanding({ ...old, intro: '', links: [], resumes: [] }).sections, []);
  const { publishedAt, ...draft } = upgraded;
  assert.deepEqual(validateLanding(draft, known('main')), draft);
});

test('initialLanding takes only what the landing page allows from the published header', () => {
  const draft = initialLanding('main', {
    name: 'Jo',
    title: 'Engineer',
    photoUrl: 'data:image/jpeg;base64,AAAA',
    links: [
      { type: 'github', label: 'gh', url: 'https://github.com/jo', note: 'dropped' },
      { label: 'bad', url: 'javascript:alert(1)' },
      { label: 'empty', url: '' },
      'not a link',
    ],
  });
  assert.equal(draft.headline, 'Jo');
  assert.equal(draft.subheadline, 'Engineer');
  assert.deepEqual(draft.sections, [
    { id: 'intro', kind: 'text', title: '', body: '' },
    { id: 'links', kind: 'links', title: '', links: [{ type: 'github', label: 'gh', url: 'https://github.com/jo' }] },
    { id: 'resumes', kind: 'resumes', title: '', cards: [{ resumeId: 'main', label: '', blurb: '', showPdf: false }] },
  ]);
  // It's a valid draft as it stands.
  assert.deepEqual(validateLanding(draft, known('main')), draft);
  assert.deepEqual(initialLanding('main', null).sections.map((s) => s.kind), ['text', 'resumes']);
});

test("initialLanding starts the links with the header's email and phone", () => {
  const header = { email: ' jo@example.com ', phone: '+1 (555) 555-0100', links: [{ type: 'github', label: 'gh', url: 'https://github.com/jo' }] };
  const draft = initialLanding('main', header);
  assert.deepEqual(draft.sections[1].links, [
    { type: 'email', label: 'jo@example.com', url: 'mailto:jo@example.com' },
    { type: 'phone', label: '+1 (555) 555-0100', url: 'tel:+15555550100' },
    { type: 'github', label: 'gh', url: 'https://github.com/jo' },
  ]);
  assert.deepEqual(validateLanding(draft, known('main')), draft);
  // A phone with nothing to dial, a blank email, or one too many links.
  const many = Array.from({ length: LANDING_LIMITS.links }, (_, i) => ({ label: `l${i}`, url: `https://x.example/${i}` }));
  const links = initialLanding('main', { email: ' ', phone: 'ask me', links: many }).sections[1].links;
  assert.deepEqual(links, many.map((l) => ({ ...l })));
  const capped = initialLanding('main', { email: 'jo@example.com', links: many }).sections[1].links;
  assert.equal(capped.length, LANDING_LIMITS.links);
  assert.equal(capped[0].type, 'email');
  // An email also makes the first button; no email, no button.
  assert.deepEqual(draft.actions, [{ type: 'link', label: 'Email me', url: 'mailto:jo@example.com' }]);
  assert.deepEqual(initialLanding('main', { email: ' ' }).actions, []);
});

test('resolveLanding shows only available resumes, without ids or internal names', () => {
  const landing = {
    ...emptyLanding(),
    photo: 'resume',
    sections: [
      { id: 'intro', kind: 'text', title: 'About', body: 'Hello' },
      { id: 'blank', kind: 'text', title: 'Nothing here', body: '  \n ' },
      { id: 'links', kind: 'links', title: '', links: [{ label: '', url: 'https://a.example' }, { label: 'no url', url: '' }] },
      {
        id: 'projects',
        kind: 'items',
        title: 'Projects',
        items: [
          { title: 'Tool', text: 'Does things', url: 'https://tool.example' },
          { title: '', text: '', url: 'https://empty.example' },
          { title: '', text: 'Just text', url: '' },
        ],
      },
      {
        id: 'cards',
        kind: 'resumes',
        title: 'Resumes',
        cards: [
          { resumeId: 'main', label: '', blurb: 'Hi' },
          { resumeId: 'private', label: 'Secret', blurb: '' },
          { resumeId: 'sales', label: 'Sales', blurb: '' },
        ],
      },
      { id: 'hidden', kind: 'resumes', title: 'Gone', cards: [{ resumeId: 'private', label: 'Secret', blurb: '' }] },
    ],
  };
  const context = {
    photoUrl: 'data:image/jpeg;base64,AAAA',
    site: { title: 'T' },
    resumes: new Map([
      ['main', { href: '/resume', title: 'Engineer' }],
      ['sales', { href: '/r/sales', title: '' }],
    ]),
  };
  const out = resolveLanding(landing, context);
  assert.deepEqual(out.sections, [
    { kind: 'text', title: 'About', body: 'Hello' },
    { kind: 'links', title: '', links: [{ label: 'https://a.example', url: 'https://a.example' }] },
    {
      kind: 'items',
      title: 'Projects',
      items: [
        { title: 'Tool', text: 'Does things', url: 'https://tool.example' },
        { title: '', text: 'Just text', url: '' },
      ],
    },
    {
      kind: 'resumes',
      title: 'Resumes',
      cards: [
        { label: 'Engineer', blurb: 'Hi', href: '/resume' },
        { label: 'Sales', blurb: '', href: '/r/sales' },
      ],
    },
  ]);
  const body = JSON.stringify(out);
  assert.equal(body.includes('private'), false);
  assert.equal(body.includes('Secret'), false);
  assert.equal(body.includes('projects'), false); // section ids stay on the server
  assert.equal(out.photoUrl, context.photoUrl);
  assert.equal(resolveLanding({ ...landing, photo: 'none' }, context).photoUrl, '');
  assert.equal(resolveLanding({ ...landing, photo: 'custom', photoUrl: 'data:image/png;base64,BB' }, context).photoUrl, 'data:image/png;base64,BB');
});

test('actions and availability are checked strictly; a new resume action must name an existing resume', () => {
  const actions = (list, refs = known('a')) => validateLanding({ actions: list }, refs).actions;
  assert.deepEqual(actions([{ type: 'link', url: 'mailto:jo@example.com?subject=Hello' }, { type: 'resume', resumeId: 'a' }]), [
    { type: 'link', label: '', url: 'mailto:jo@example.com?subject=Hello' },
    { type: 'resume', label: '', resumeId: 'a', open: 'page' },
  ]);
  assert.equal(validateLanding({ availability: 'Open to work · Remote' }, known()).availability, 'Open to work · Remote');
  const bad = [
    { availability: 'x'.repeat(LANDING_LIMITS.availability + 1) },
    { availability: 7 },
    { actions: 'Email me' },
    { actions: Array.from({ length: LANDING_LIMITS.actions + 1 }, () => ({ type: 'link', url: 'https://x.example' })) },
    { actions: [{ url: 'https://x.example' }] },
    { actions: [{ type: 'button', url: 'https://x.example' }] },
    { actions: [{ type: 'link', url: 'java\tscript:alert(1)' }] },
    { actions: [{ type: 'link', url: 'https://x.example', resumeId: 'a' }] },
    { actions: [{ type: 'link', label: 'x'.repeat(LANDING_LIMITS.actionLabel + 1), url: 'https://x.example' }] },
    { actions: [{ type: 'resume', resumeId: 'a', open: 'print' }] },
    { actions: [{ type: 'resume', resumeId: 'a', url: 'https://x.example' }] },
    { actions: [{ type: 'resume' }] },
    { actions: [{ type: 'resume', resumeId: 'gone' }] },
    { sections: [cardsSection([{ resumeId: 'a', showPdf: 'yes' }])] },
  ];
  for (const input of bad) assert.equal(status(() => validateLanding(input, known('a'))), 400, JSON.stringify(input));

  // One already in the draft may outlive its resume, as a card may, and
  // counts as a reference for the next save.
  const kept = actions([{ type: 'resume', resumeId: 'gone', open: 'pdf' }], { knownResumeIds: new Set(['a']), previousResumeIds: new Set(['gone']) });
  assert.equal(kept[0].resumeId, 'gone');
  assert.deepEqual([...referencedResumeIds({ actions: kept, sections: [cardsSection([{ resumeId: 'a' }])] })].sort(), ['a', 'gone']);
  // Replaced whole by the MCP merge.
  const merged = mergeLandingPatch({ ...emptyLanding(), actions: kept }, { actions: [{ type: 'link', url: 'https://x.example' }] });
  assert.deepEqual(merged.actions, [{ type: 'link', url: 'https://x.example' }]);
  // A draft stored before them reads with none.
  const { availability: _a, actions: _b, ...old } = emptyLanding();
  assert.deepEqual(upgradeLanding(old), emptyLanding());
});

test('actions and card PDFs resolve against what a visitor may open right now', () => {
  const landing = {
    ...emptyLanding(),
    availability: 'Open to work',
    actions: [
      { type: 'link', label: 'Email me', url: 'mailto:jo@example.com' },
      { type: 'link', label: '', url: 'https://cal.example/jo' },
      { type: 'link', label: 'Half typed', url: '' },
      { type: 'link', label: 'Bad', url: 'java\tscript:alert(1)' },
      { type: 'resume', label: '', resumeId: 'main', open: 'pdf' },
      { type: 'resume', label: 'Sales', resumeId: 'sales', open: 'page' },
      { type: 'resume', label: 'Sales PDF', resumeId: 'sales', open: 'pdf' },
      { type: 'resume', label: 'Secret', resumeId: 'private', open: 'page' },
    ],
    sections: [
      {
        id: 'cards',
        kind: 'resumes',
        title: '',
        cards: [
          { resumeId: 'main', label: '', blurb: '', showPdf: true },
          { resumeId: 'sales', label: '', blurb: '', showPdf: true },
          { resumeId: 'other', label: '', blurb: '', showPdf: false },
        ],
      },
    ],
  };
  const context = {
    photoUrl: '',
    site: null,
    resumes: new Map([
      ['main', { href: '/resume', title: 'Engineer', pdfHref: '/api/public/resume.pdf?v=1-2' }],
      ['sales', { href: '/r/sales', title: 'Sales', pdfHref: '' }],
      ['other', { href: '/r/other', title: 'Other', pdfHref: '/api/public/resumes/other/resume.pdf?v=3-4' }],
    ]),
  };
  const out = resolveLanding(landing, context);
  assert.equal(out.availability, 'Open to work');
  assert.deepEqual(out.actions, [
    { label: 'Email me', href: 'mailto:jo@example.com' },
    { label: 'https://cal.example/jo', href: 'https://cal.example/jo' },
    { label: 'Download my resume (PDF)', href: '/api/public/resume.pdf?v=1-2' },
    { label: 'Sales', href: '/r/sales' },
  ]);
  assert.deepEqual(out.sections[0].cards, [
    { label: 'Engineer', blurb: '', href: '/resume', pdfHref: '/api/public/resume.pdf?v=1-2' },
    { label: 'Sales', blurb: '', href: '/r/sales' },
    { label: 'Other', blurb: '', href: '/r/other' },
  ]);
  const body = JSON.stringify(out);
  for (const leak of ['private', 'Secret', 'resumeId', '"main"']) assert.equal(body.includes(leak), false, leak);
  // A snapshot from before actions resolves with none.
  const { actions: _a, availability: _b, ...old } = landing;
  assert.deepEqual(resolveLanding(old, context).actions, []);
});

test('homeLink is a boolean, on unless switched off, and never part of what the page resolves to', () => {
  assert.equal(emptyLanding().homeLink, true);
  assert.equal(validateLanding({}, known()).homeLink, true);
  assert.equal(validateLanding({ homeLink: false }, known()).homeLink, false);
  for (const value of ['no', 0, 1, {}, []]) {
    assert.equal(status(() => validateLanding({ homeLink: value }, known())), 400, JSON.stringify(value));
  }
  // The MCP merge: null resets it to on.
  const off = validateLanding({ homeLink: false }, known());
  assert.equal(validateLanding(mergeLandingPatch(off, { headline: 'Jo' }), known()).homeLink, false);
  assert.equal(validateLanding(mergeLandingPatch(off, { homeLink: null }), known()).homeLink, true);
  // A draft or snapshot stored before it existed has it on; one switched
  // off stays off.
  const { homeLink: _, ...old } = emptyLanding();
  assert.equal(upgradeLanding(old).homeLink, true);
  assert.equal(upgradeLanding(off).homeLink, false);
  // It's read by the resume pages' link (landingStore.js), not shown here.
  assert.equal('homeLink' in resolveLanding(emptyLanding(), { resumes: new Map() }), false);
});

test('homeLinkLabel is a short string, empty unless set, and never part of what the page resolves to', () => {
  assert.equal(emptyLanding().homeLinkLabel, '');
  assert.equal(validateLanding({}, known()).homeLinkLabel, '');
  assert.equal(validateLanding({ homeLinkLabel: 'Jo Doe' }, known()).homeLinkLabel, 'Jo Doe');
  // Not trimmed on save (the editor saves while someone types).
  assert.equal(validateLanding({ homeLinkLabel: 'Jo ' }, known()).homeLinkLabel, 'Jo ');
  const atCap = 'x'.repeat(LANDING_LIMITS.homeLinkLabel);
  assert.equal(validateLanding({ homeLinkLabel: atCap }, known()).homeLinkLabel, atCap);
  assert.equal(status(() => validateLanding({ homeLinkLabel: `${atCap}x` }, known())), 400);
  for (const value of [5, true, {}, []]) {
    assert.equal(status(() => validateLanding({ homeLinkLabel: value }, known())), 400, JSON.stringify(value));
  }
  // The MCP merge: null resets it to empty.
  const named = validateLanding({ homeLinkLabel: 'Jo' }, known());
  assert.equal(validateLanding(mergeLandingPatch(named, { homeLinkLabel: null }), known()).homeLinkLabel, '');
  // A draft or snapshot stored before it existed has the empty one.
  const { homeLinkLabel: _, ...old } = emptyLanding();
  assert.equal(upgradeLanding(old).homeLinkLabel, '');
  assert.equal(upgradeLanding(named).homeLinkLabel, 'Jo');
  assert.equal('homeLinkLabel' in resolveLanding(named, { resumes: new Map() }), false);
});
