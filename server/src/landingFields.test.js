import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDING_LIMITS,
  LINK_TYPES,
  referencedResumeIds,
  emptyLanding,
  experienceRoles,
  educationEntries,
  skillGroups,
  splitSkillItems,
  initialLanding,
  isSafeUrl,
  mergeLandingPatch,
  resolveLanding,
  telUrl,
  upgradeLanding,
  validateLanding,
} from './landingFields.js';
import { LANDING_IMAGE_LIMITS, assertImagesDescribed, checkImageRef, imageIdOfPath, referencedImageIds, resolveImage, shownImageIds } from './landingImageFields.js';

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

test('links inside a text section or an item follow the same rules, named by section and paragraph', () => {
  const text = (body) => ({ sections: [{ id: 't', kind: 'text', body }] });
  const item = (itemText) => ({ sections: [{ id: 't', kind: 'text', body: '' }, { id: 'i', kind: 'items', items: [{ title: 'a', text: itemText }] }] });
  const message = (fn) => {
    try {
      fn();
    } catch (err) {
      return `${err.status} ${err.message}`;
    }
    return null;
  };
  for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', '\u0001javascript:alert(1)', 'data:text/html,<script>x</script>', 'vbscript:x']) {
    assert.equal(
      message(() => validateLanding(text(`Fine.\n\nSee [**my** blog](${url}).`), known())),
      '400 sections[0].body, paragraph 2: the link "my blog" must be an http, https, mailto or tel link',
      url
    );
    assert.equal(message(() => validateLanding(item(`[x](${url})`), known())), '400 sections[1].items[0].text: the link "x" must be an http, https, mailto or tel link', url);
  }
  // A URL can't hold a space, so one hidden by a tab or newline isn't a link at all: it shows as text.
  for (const body of ['[a](java\tscript:alert(1))', '[a](java\nscript:x)']) {
    assert.equal(validateLanding(text(body), known()).sections[0].body, body);
  }
  // Safe, relative, half typed or escaped: saved as written.
  for (const body of [
    'At [my blog](https://jo.example), **Acme** and *more*.',
    '[mail](mailto:jo@example.com) [call](tel:+15555550100) [home](/resume)',
    '[half typed](https://)',
    '\\[not a link](javascript:alert(1))',
  ]) {
    assert.equal(validateLanding(text(body), known()).sections[0].body, body);
    assert.equal(validateLanding(item(body), known()).sections[1].items[0].text, body);
  }
  // The cap counts the text as written, markup included.
  const long = `[${'a'.repeat(LANDING_LIMITS.text - 20)}](https://x.example)`;
  assert.equal(status(() => validateLanding(text(long), known())), 400);
  // Other fields are plain text, so a URL there is never a link.
  assert.equal(validateLanding({ headline: '[x](javascript:alert(1))' }, known()).headline, '[x](javascript:alert(1))');
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

test('a link of every type saves and shows with its type (issue #129)', () => {
  for (const type of LINK_TYPES) {
    const links = [{ type, label: type, url: 'https://example.com/jo' }];
    const draft = validateLanding(linksSection(links), known());
    assert.deepEqual(draft.sections[0].links, links, type);
    assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).sections[0].links, links, type);
  }
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
    template: 'classic',
    style: { source: 'resume', colors: { accent: '', heading: '', text: '', background: '' }, font: '', nameFont: '' },
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

test('any section can be hidden: kept in the draft, never shown', () => {
  const draft = validateLanding(
    {
      sections: [
        { id: 'now', kind: 'text', title: 'Now', body: 'Reading', hidden: true },
        { id: 'intro', kind: 'text', body: 'Hi', hidden: false },
      ],
    },
    known()
  );
  // Only stored when set.
  assert.deepEqual(draft.sections, [
    { id: 'now', kind: 'text', title: 'Now', body: 'Reading', hidden: true },
    { id: 'intro', kind: 'text', title: '', body: 'Hi' },
  ]);
  const out = resolveLanding(draft, { resumes: new Map() });
  assert.deepEqual(out.sections, [{ kind: 'text', title: '', body: 'Hi' }]);
  assert.equal(JSON.stringify(out).includes('Reading'), false);
  assert.equal(status(() => validateLanding({ sections: [{ id: 's', kind: 'links', hidden: 'yes' }] }, known())), 400);
});

test("any section may go in a template's side column: stored only when 'side', and shown with it", () => {
  const draft = validateLanding(
    {
      sections: [
        { id: 'a', kind: 'text', body: 'Side', column: 'side' },
        { id: 'b', kind: 'text', body: 'Main', column: 'main' },
        { id: 'c', kind: 'text', body: 'Hidden', column: 'side', hidden: true },
      ],
    },
    known()
  );
  assert.deepEqual(draft.sections, [
    { id: 'a', kind: 'text', title: '', column: 'side', body: 'Side' },
    { id: 'b', kind: 'text', title: '', body: 'Main' },
    { id: 'c', kind: 'text', title: '', hidden: true, column: 'side', body: 'Hidden' },
  ]);
  assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).sections, [
    { kind: 'text', title: '', column: 'side', body: 'Side' },
    { kind: 'text', title: '', body: 'Main' },
  ]);
  for (const column of ['left', '', true, null]) {
    assert.equal(status(() => validateLanding({ sections: [{ id: 's', kind: 'text', column }] }, known())), column === null ? null : 400);
  }
});

test('a divider is only a title, and is always shown unless hidden', () => {
  const draft = validateLanding(
    {
      sections: [
        { id: 'a', kind: 'divider' },
        { id: 'b', kind: 'divider', title: 'Or', column: 'side' },
        { id: 'c', kind: 'divider', hidden: true },
      ],
    },
    known()
  );
  assert.deepEqual(draft.sections, [
    { id: 'a', kind: 'divider', title: '' },
    { id: 'b', kind: 'divider', title: 'Or', column: 'side' },
    { id: 'c', kind: 'divider', title: '', hidden: true },
  ]);
  assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).sections, [
    { kind: 'divider', title: '' },
    { kind: 'divider', title: 'Or', column: 'side' },
  ]);
  assert.equal(status(() => validateLanding({ sections: [{ id: 's', kind: 'divider', body: 'x' }] }, known())), 400);
  assert.equal(status(() => validateLanding({ sections: [{ id: 's', kind: 'divider', title: 'x'.repeat(LANDING_LIMITS.sectionTitle + 1) }] }, known())), 400);
});

test('an item may carry a short meta line, stored and shown only when set', () => {
  const draft = validateLanding(
    { sections: [{ id: 'i', kind: 'items', items: [{ title: 'Tool', meta: '2024 · Rust' }, { title: 'Other', meta: '' }, { title: 'Third', meta: '  ' }] }] },
    known()
  );
  assert.deepEqual(draft.sections[0].items, [
    { title: 'Tool', text: '', url: '', meta: '2024 · Rust' },
    { title: 'Other', text: '', url: '' },
    { title: 'Third', text: '', url: '', meta: '  ' },
  ]);
  assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).sections[0].items, [
    { title: 'Tool', text: '', url: '', meta: '2024 · Rust' },
    { title: 'Other', text: '', url: '' },
    { title: 'Third', text: '', url: '' },
  ]);
  const item = (meta) => ({ sections: [{ id: 'i', kind: 'items', items: [{ title: 'T', meta }] }] });
  assert.equal(status(() => validateLanding(item('x'.repeat(LANDING_LIMITS.itemMeta + 1)), known())), 400);
  assert.equal(status(() => validateLanding(item(5), known())), 400);
});

test('quotes are checked strictly, and an empty one is dropped', () => {
  const quotes = (list) => ({ sections: [{ id: 'q', kind: 'quotes', title: 'Kind words', quotes: list }] });
  const first = { text: 'Great to work with.', name: 'Ann', role: 'Manager, Acme', url: 'https://ann.example' };
  const draft = validateLanding(quotes([first, { name: 'Nobody' }]), known());
  assert.deepEqual(draft.sections[0].quotes, [first, { text: '', name: 'Nobody', role: '', url: '' }]);
  assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).sections, [{ kind: 'quotes', title: 'Kind words', quotes: [first] }]);
  // A section with no quote left to show goes, heading and all.
  assert.deepEqual(resolveLanding(validateLanding(quotes([{ text: ' ', name: 'Ann' }]), known()), { resumes: new Map() }).sections, []);
  const half = validateLanding(quotes([{ text: 'Hi', url: 'https://' }]), known());
  assert.equal(resolveLanding(half, { resumes: new Map() }).sections[0].quotes[0].url, '');

  const bad = [
    quotes([{ text: 'x'.repeat(LANDING_LIMITS.quoteText + 1) }]),
    quotes([{ text: 'Hi', name: 'x'.repeat(LANDING_LIMITS.quoteName + 1) }]),
    quotes([{ text: 'Hi', role: 'x'.repeat(LANDING_LIMITS.quoteRole + 1) }]),
    quotes([{ text: 'Hi', url: 'java\tscript:alert(1)' }]),
    quotes([{ text: 'Hi', photo: 'x' }]),
    quotes([{ text: 5 }]),
    quotes('Hi'),
    quotes(Array.from({ length: LANDING_LIMITS.quotes + 1 }, () => ({ text: 'Hi' }))),
    { sections: [{ id: 'q', kind: 'quotes', items: [] }] },
  ];
  for (const input of bad) assert.equal(status(() => validateLanding(input, known())), 400, JSON.stringify(input).slice(0, 80));
});

test('stats are checked strictly, and one without a value is dropped', () => {
  const stats = (list, extra = {}) => ({ sections: [{ id: 'n', kind: 'stats', title: 'By the numbers', stats: list, ...extra }] });
  const first = { value: '15 years', label: 'in commercial kitchens' };
  const draft = validateLanding(stats([first, { label: 'No value' }, { value: '#1' }, { value: ' ', label: 'Blank' }], { column: 'side' }), known());
  assert.deepEqual(draft.sections[0], {
    id: 'n',
    kind: 'stats',
    title: 'By the numbers',
    column: 'side',
    stats: [first, { value: '', label: 'No value' }, { value: '#1', label: '' }, { value: ' ', label: 'Blank' }],
  });
  assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).sections, [
    { kind: 'stats', title: 'By the numbers', column: 'side', stats: [first, { value: '#1', label: '' }] },
  ]);
  // A section with no stat left to show goes, heading and all, as does an
  // empty or hidden one.
  assert.deepEqual(resolveLanding(validateLanding(stats([{ value: ' ', label: 'Only a label' }]), known()), { resumes: new Map() }).sections, []);
  assert.deepEqual(resolveLanding(validateLanding({ sections: [{ id: 'n', kind: 'stats' }] }, known()), { resumes: new Map() }).sections, []);
  assert.deepEqual(resolveLanding(validateLanding(stats([first], { hidden: true }), known()), { resumes: new Map() }).sections, []);
  // At the caps is fine.
  const full = Array.from({ length: LANDING_LIMITS.stats }, () => ({ value: 'x'.repeat(LANDING_LIMITS.statValue), label: 'y'.repeat(LANDING_LIMITS.statLabel) }));
  assert.equal(validateLanding(stats(full), known()).sections[0].stats.length, LANDING_LIMITS.stats);

  const bad = [
    stats([{ value: 'x'.repeat(LANDING_LIMITS.statValue + 1) }]),
    stats([{ value: '1', label: 'x'.repeat(LANDING_LIMITS.statLabel + 1) }]),
    stats([{ value: 42 }]),
    stats([{ value: '1', url: 'https://example.com' }]),
    stats(['15 years']),
    stats('15 years'),
    stats(Array.from({ length: LANDING_LIMITS.stats + 1 }, () => ({ value: '1' }))),
    { sections: [{ id: 'n', kind: 'stats', items: [] }] },
  ];
  for (const input of bad) assert.equal(status(() => validateLanding(input, known())), 400, JSON.stringify(input).slice(0, 80));
});

test('an FAQ section is checked strictly, its answers as inline text, and an entry without both parts is dropped', () => {
  const faq = (entries) => ({ sections: [{ id: 'f', kind: 'faq', title: 'Questions', entries }] });
  const message = (fn) => {
    try {
      fn();
    } catch (err) {
      return `${err.status} ${err.message}`;
    }
    return null;
  };
  const first = { question: 'Are you open to relocating?', answer: 'Yes, within **Europe**. [Ask me](mailto:jo@example.com).' };
  const draft = validateLanding(faq([first, { question: 'When can you start?' }, { answer: 'An answer to nothing.' }, { question: ' ', answer: 'x' }]), known());
  assert.deepEqual(draft.sections[0], {
    id: 'f',
    kind: 'faq',
    title: 'Questions',
    entries: [first, { question: 'When can you start?', answer: '' }, { question: '', answer: 'An answer to nothing.' }, { question: ' ', answer: 'x' }],
  });
  assert.deepEqual(resolveLanding(draft, { resumes: new Map() }).sections, [{ kind: 'faq', title: 'Questions', entries: [first] }]);
  // A section with no entry left to show goes, heading and all.
  assert.deepEqual(resolveLanding(validateLanding(faq([{ question: 'Why?', answer: '  ' }]), known()), { resumes: new Map() }).sections, []);
  assert.deepEqual(resolveLanding(validateLanding(faq([]), known()), { resumes: new Map() }).sections, []);

  // An answer's links follow every other link's rules, read as one paragraph
  // like an item's text; a question is plain text, never a link.
  assert.equal(
    message(() => validateLanding(faq([{ question: 'Q', answer: 'See\n\n[this](javascript:alert(1))' }]), known())),
    '400 sections[0].entries[0].answer: the link "this" must be an http, https, mailto or tel link'
  );
  assert.equal(validateLanding(faq([{ question: '[x](javascript:alert(1))', answer: 'A' }]), known()).sections[0].entries[0].question, '[x](javascript:alert(1))');
  // The answer's cap doesn't count an escaping backslash; the question's counts every character.
  const atCap = `\\*${'a'.repeat(LANDING_LIMITS.faqAnswer - 1)}`;
  assert.equal(validateLanding(faq([{ question: 'Q', answer: atCap }]), known()).sections[0].entries[0].answer, atCap);
  const longest = 'x'.repeat(LANDING_LIMITS.faqQuestion);
  assert.equal(validateLanding(faq([{ question: longest, answer: 'A' }]), known()).sections[0].entries[0].question, longest);

  const bad = [
    faq([{ question: 'x'.repeat(LANDING_LIMITS.faqQuestion + 1), answer: 'A' }]),
    faq([{ question: 'Q', answer: 'x'.repeat(LANDING_LIMITS.faqAnswer + 1) }]),
    faq([{ question: 'Q', answer: 'A', open: true }]),
    faq([{ question: 5 }]),
    faq([{ answer: ['A'] }]),
    faq(['Q']),
    faq('Q'),
    faq(Array.from({ length: LANDING_LIMITS.faqEntries + 1 }, () => ({ question: 'Q', answer: 'A' }))),
    { sections: [{ id: 'f', kind: 'faq', items: [] }] },
  ];
  for (const input of bad) assert.equal(status(() => validateLanding(input, known())), 400, JSON.stringify(input).slice(0, 80));
});

test('an experience section follows the reference rules of a card, with a count from 1 to 10', () => {
  const section = (extra) => ({ sections: [{ id: 'x', kind: 'experience', ...extra }] });
  assert.deepEqual(validateLanding(section({ resumeId: 'a' }), known('a')).sections[0], {
    id: 'x',
    kind: 'experience',
    title: '',
    resumeId: 'a',
    count: 3,
    showDates: true,
  });
  const set = validateLanding(section({ resumeId: 'a', count: 10, showDates: false }), known('a')).sections[0];
  assert.deepEqual([set.count, set.showDates], [10, false]);
  for (const extra of [
    { resumeId: 'gone' },
    {},
    { resumeId: 'a', count: 0 },
    { resumeId: 'a', count: LANDING_LIMITS.experienceCount + 1 },
    { resumeId: 'a', count: 2.5 },
    { resumeId: 'a', count: '3' },
    { resumeId: 'a', showDates: 'yes' },
    { resumeId: 'a', blockIds: ['b1'] },
  ]) {
    assert.equal(status(() => validateLanding(section(extra), known('a'))), 400, JSON.stringify(extra));
  }
  // One already in the draft may outlive its resume, and counts as a reference.
  const kept = validateLanding(section({ resumeId: 'gone' }), { knownResumeIds: new Set(['a']), previousResumeIds: new Set(['gone']) });
  assert.equal(kept.sections[0].resumeId, 'gone');
  assert.deepEqual([...referencedResumeIds(kept)], ['gone']);
});

test('experienceRoles reads only web-visible experience entries, in order, without descriptions or bullets', () => {
  const block = (id, type, data, flags = {}) => ({ id, type, parentId: null, visibleWeb: true, visiblePrint: true, data, ...flags });
  const blocks = [
    block('h', 'heading', { text: 'Experience' }),
    block('e1', 'experience', {
      jobTitle: ' SRE ',
      company: 'Acme',
      companyUrl: 'https://acme.example',
      location: 'Remote',
      startDate: '2022',
      endDate: 'Present',
      description: 'Secret sauce',
      bullets: [{ text: 'Did a thing' }],
    }),
    block('e2', 'experience', { jobTitle: 'Print only', company: 'Hidden Co' }, { visibleWeb: false }),
    block('s', 'summary', { text: 'Not a role' }),
    block('e3', 'experience', { jobTitle: '', company: '' }),
    block('e4', 'experience', { company: 'Beta' }),
    block('e5', 'experience', null),
  ];
  assert.deepEqual(experienceRoles(blocks), [
    { jobTitle: 'SRE', company: 'Acme', companyUrl: 'https://acme.example', location: 'Remote', startDate: '2022', endDate: 'Present' },
    { jobTitle: '', company: 'Beta', companyUrl: '', location: '', startDate: '', endDate: '' },
  ]);
  assert.deepEqual(experienceRoles(undefined), []);
  const many = Array.from({ length: 15 }, (_, i) => block(`m${i}`, 'experience', { jobTitle: `Role ${i}` }));
  assert.equal(experienceRoles(many).length, LANDING_LIMITS.experienceCount);
});

test("an experience section resolves its resume's first roles, without ids", () => {
  const roles = [
    { jobTitle: 'SRE', company: 'Acme', companyUrl: 'https://acme.example', location: 'Remote', startDate: '2022', endDate: 'Present' },
    { jobTitle: 'Dev', company: 'Beta', companyUrl: 'java\tscript:alert(1)', location: '', startDate: '2019', endDate: '' },
    { jobTitle: 'Intern', company: 'Gamma', companyUrl: '', location: '', startDate: '', endDate: '2018' },
  ];
  const context = { resumes: new Map([['main', { href: '/resume', title: 'Engineer', pdfHref: '', experience: roles }]]) };
  const landing = {
    ...emptyLanding(),
    sections: [
      { id: 'x', kind: 'experience', title: 'Recently', resumeId: 'main', count: 2, showDates: true },
      { id: 'y', kind: 'experience', title: 'No dates', resumeId: 'main', count: 10, showDates: false },
      { id: 'z', kind: 'experience', title: 'Private', resumeId: 'private', count: 3, showDates: true },
      { id: 'w', kind: 'experience', title: 'Hidden', resumeId: 'main', count: 3, showDates: true, hidden: true },
    ],
  };
  const out = resolveLanding(landing, context);
  assert.deepEqual(out.sections, [
    {
      kind: 'experience',
      title: 'Recently',
      href: '/resume',
      roles: [
        { jobTitle: 'SRE', company: 'Acme', companyUrl: 'https://acme.example', location: 'Remote', dates: '2022 – Present' },
        { jobTitle: 'Dev', company: 'Beta', companyUrl: '', location: '', dates: '2019' },
      ],
    },
    {
      kind: 'experience',
      title: 'No dates',
      href: '/resume',
      roles: [
        { jobTitle: 'SRE', company: 'Acme', companyUrl: 'https://acme.example', location: 'Remote', dates: '' },
        { jobTitle: 'Dev', company: 'Beta', companyUrl: '', location: '', dates: '' },
        { jobTitle: 'Intern', company: 'Gamma', companyUrl: '', location: '', dates: '' },
      ],
    },
  ]);
  const body = JSON.stringify(out);
  for (const leak of ['resumeId', '"main"', 'private', 'Private', 'Hidden']) assert.equal(body.includes(leak), false, leak);
  // A resume with no roles to show takes the section off.
  const none = { resumes: new Map([['main', { href: '/resume', title: '', pdfHref: '', experience: [] }]]) };
  assert.deepEqual(resolveLanding(landing, none).sections, []);
});

test('education and skills sections follow the reference rules of a card; education counts from 1 to 10', () => {
  const section = (kind, extra) => ({ sections: [{ id: 'x', kind, ...extra }] });
  assert.deepEqual(validateLanding(section('education', { resumeId: 'a' }), known('a')).sections[0], {
    id: 'x',
    kind: 'education',
    title: '',
    resumeId: 'a',
    count: 3,
    showDates: true,
  });
  const set = validateLanding(section('education', { resumeId: 'a', count: 10, showDates: false, column: 'side' }), known('a')).sections[0];
  assert.deepEqual([set.count, set.showDates, set.column], [10, false, 'side']);
  assert.deepEqual(validateLanding(section('skills', { resumeId: 'a', title: 'Skills' }), known('a')).sections[0], {
    id: 'x',
    kind: 'skills',
    title: 'Skills',
    resumeId: 'a',
  });
  for (const extra of [
    { resumeId: 'gone' },
    {},
    { resumeId: 'a', count: 0 },
    { resumeId: 'a', count: LANDING_LIMITS.educationCount + 1 },
    { resumeId: 'a', count: 2.5 },
    { resumeId: 'a', showDates: 'yes' },
    { resumeId: 'a', blockIds: ['b1'] },
  ]) {
    assert.equal(status(() => validateLanding(section('education', extra), known('a'))), 400, JSON.stringify(extra));
  }
  for (const extra of [{ resumeId: 'gone' }, {}, { resumeId: 'a', count: 3 }, { resumeId: 'a', showDates: true }, { resumeId: 'a', categories: ['Languages'] }]) {
    assert.equal(status(() => validateLanding(section('skills', extra), known('a'))), 400, JSON.stringify(extra));
  }
  // One already in the draft may outlive its resume, and counts as a reference.
  const kept = validateLanding(
    { sections: [{ id: 'e', kind: 'education', resumeId: 'gone' }, { id: 's', kind: 'skills', resumeId: 'gone2' }] },
    { knownResumeIds: new Set(['a']), previousResumeIds: new Set(['gone', 'gone2']) }
  );
  assert.deepEqual(kept.sections.map((s) => s.resumeId), ['gone', 'gone2']);
  assert.deepEqual([...referencedResumeIds(kept)], ['gone', 'gone2']);
});

test('educationEntries and skillGroups read only web-visible blocks, in order, with only what the sections show', () => {
  const block = (id, type, data, flags = {}) => ({ id, type, parentId: null, visibleWeb: true, visiblePrint: true, data, ...flags });
  const blocks = [
    block('h', 'heading', { text: 'Education' }),
    block('d1', 'education', { degree: ' BSc Nursing ', institution: 'State U', location: 'Ohio', startDate: '2010', endDate: '2014', style: { color: 'x' } }),
    block('d2', 'education', { degree: 'Print only', institution: 'Hidden U' }, { visibleWeb: false }),
    block('d3', 'education', { degree: '', institution: '' }),
    block('d5', 'education', { institution: 'Trade school' }, { parentId: 'h' }),
    block('d6', 'education', null),
    block('g1', 'skills_group', { category: 'Languages', items: 'Spanish (fluent), ASL (conversational) ,, ' }),
    block('g2', 'skills_group', { category: 'Print only', items: 'Secret' }, { visibleWeb: false }),
    block('g3', 'skills_group', { category: 'Empty', items: ' , ' }),
    block('g4', 'skills_group', { items: 'Go' }),
    block('g5', 'skills_group', { category: 'Odd', items: 42 }),
  ];
  assert.deepEqual(educationEntries(blocks), [
    { degree: 'BSc Nursing', institution: 'State U', location: 'Ohio', startDate: '2010', endDate: '2014' },
    { degree: '', institution: 'Trade school', location: '', startDate: '', endDate: '' },
  ]);
  assert.deepEqual(skillGroups(blocks), [
    { category: 'Languages', items: ['Spanish (fluent)', 'ASL (conversational)'] },
    { category: '', items: ['Go'] },
  ]);
  assert.deepEqual(educationEntries(undefined), []);
  assert.deepEqual(skillGroups(undefined), []);
  const many = Array.from({ length: 15 }, (_, i) => block(`m${i}`, 'education', { degree: `Degree ${i}` }));
  assert.equal(educationEntries(many).length, LANDING_LIMITS.educationCount);
  assert.deepEqual(splitSkillItems(' a,b ,,c '), ['a', 'b', 'c']);
  assert.deepEqual(splitSkillItems(undefined), []);
});

test("education and skills sections resolve from their resume, without ids", () => {
  const education = [
    { degree: 'BSc Nursing', institution: 'State U', location: 'Ohio', startDate: '2010', endDate: '2014' },
    { degree: 'Apprenticeship', institution: 'Guild', location: '', startDate: '2008', endDate: '' },
  ];
  const skills = [
    { category: 'Languages', items: ['Spanish (fluent)', 'ASL'] },
    { category: '', items: ['Triage'] },
  ];
  const context = { resumes: new Map([['main', { href: '/r/nurse', title: 'Nurse', pdfHref: '', experience: [], education, skills }]]) };
  const landing = {
    ...emptyLanding(),
    sections: [
      { id: 'e', kind: 'education', title: 'Education', resumeId: 'main', count: 1, showDates: true },
      { id: 'e2', kind: 'education', title: '', resumeId: 'main', count: 10, showDates: false, column: 'side' },
      { id: 's', kind: 'skills', title: 'Skills', resumeId: 'main' },
      { id: 'p', kind: 'skills', title: 'Private', resumeId: 'private' },
      { id: 'q', kind: 'education', title: 'Private', resumeId: 'private', count: 3, showDates: true },
      { id: 'h', kind: 'skills', title: 'Hidden', resumeId: 'main', hidden: true },
    ],
  };
  const out = resolveLanding(landing, context);
  assert.deepEqual(out.sections, [
    {
      kind: 'education',
      title: 'Education',
      href: '/r/nurse',
      entries: [{ degree: 'BSc Nursing', institution: 'State U', location: 'Ohio', dates: '2010 – 2014' }],
    },
    {
      kind: 'education',
      title: '',
      column: 'side',
      href: '/r/nurse',
      entries: [
        { degree: 'BSc Nursing', institution: 'State U', location: 'Ohio', dates: '' },
        { degree: 'Apprenticeship', institution: 'Guild', location: '', dates: '' },
      ],
    },
    { kind: 'skills', title: 'Skills', href: '/r/nurse', groups: skills },
  ]);
  // A copy, so a visitor's page never shares the context's arrays.
  assert.notEqual(out.sections[2].groups[0].items, skills[0].items);
  const body = JSON.stringify(out);
  for (const leak of ['resumeId', '"main"', 'private', 'Private', 'Hidden']) assert.equal(body.includes(leak), false, leak);
  // A resume with nothing to show takes the sections off.
  const none = { resumes: new Map([['main', { href: '/resume', title: '', pdfHref: '', experience: [], education: [], skills: [] }]]) };
  assert.deepEqual(resolveLanding(landing, none).sections, []);
});

const IMG = 'a'.repeat(64);
const IMG2 = 'b'.repeat(64);
const withImages = (...ids) => ({ knownResumeIds: new Set(), knownImageIds: new Set(ids) });

test('image references are { imageId, alt }, checked strictly, and must name a stored image unless already in the draft', () => {
  const ref = { imageId: IMG, alt: 'Jo at a talk' };
  const out = validateLanding(
    {
      photo: 'upload',
      photoImage: ref,
      sections: [
        { id: 'i', kind: 'items', items: [{ title: 'P', image: ref }, { title: 'Q', image: null }] },
        { id: 'pic', kind: 'image', image: ref, caption: 'On stage' },
        { id: 'empty', kind: 'image' },
      ],
      seo: { image: { imageId: IMG, alt: '' } },
    },
    withImages(IMG)
  );
  assert.deepEqual(out.photoImage, ref);
  assert.deepEqual(out.sections[0].items, [{ title: 'P', text: '', url: '', image: ref }, { title: 'Q', text: '', url: '' }]);
  assert.deepEqual(out.sections[1], { id: 'pic', kind: 'image', title: '', image: ref, caption: 'On stage' });
  // A new image section starts empty; the editor uploads into it.
  assert.deepEqual(out.sections[2], { id: 'empty', kind: 'image', title: '', image: null, caption: '' });
  // alt may still be empty in a draft (the editor saves while it's typed).
  assert.deepEqual(out.seo, { title: '', description: '', noindex: false, image: { imageId: IMG, alt: '' } });
  // No image, no key: a draft without images keeps its old shape.
  assert.deepEqual(validateLanding({}, withImages(IMG)), emptyLanding());

  const bad = [
    { photoImage: { imageId: IMG } }, // alt is required
    { photoImage: { imageId: IMG, alt: 3 } },
    { photoImage: { imageId: IMG, alt: 'x'.repeat(LANDING_IMAGE_LIMITS.alt + 1) } },
    { photoImage: { imageId: IMG, alt: '', src: '/evil' } },
    { photoImage: { imageId: 'not-a-hash', alt: '' } },
    { photoImage: { imageId: IMG2, alt: '' } }, // not stored
    { photoImage: 'data:image/png;base64,AAAA' },
    { sections: [{ kind: 'image', image: { imageId: IMG2, alt: '' } }] },
    { sections: [{ kind: 'image', caption: 'x'.repeat(LANDING_IMAGE_LIMITS.caption + 1) }] },
    { sections: [{ kind: 'image', body: 'text' }] },
    { sections: [{ kind: 'items', items: [{ title: 'P', image: { imageId: IMG2, alt: '' } }] }] },
    { seo: { image: { imageId: IMG2, alt: '' } } },
    { seo: { image: 'https://example.com/me.jpg' } },
  ];
  for (const input of bad) assert.equal(status(() => validateLanding(input, withImages(IMG))), 400, JSON.stringify(input));

  // One already in the draft may outlive its image, as a card its resume.
  const kept = validateLanding({ seo: { image: { imageId: IMG2, alt: '' } } }, { ...withImages(IMG), previousImageIds: new Set([IMG2]) });
  assert.equal(kept.seo.image.imageId, IMG2);
  assert.deepEqual([...referencedImageIds({ photoImage: ref, seo: kept.seo, sections: out.sections })].sort(), [IMG, IMG2]);
  assert.deepEqual([...referencedImageIds(emptyLanding())], []);
  // The MCP merge replaces seo.image and keeps the rest of seo.
  const merged = mergeLandingPatch({ ...emptyLanding(), seo: { title: 'T', description: '', noindex: false } }, { seo: { image: ref } });
  assert.deepEqual(merged.seo, { title: 'T', description: '', noindex: false, image: ref });
  assert.equal('image' in mergeLandingPatch(merged, { seo: { image: null } }).seo, false);
});

test('images resolve to { src, alt, width, height } while stored, and drop out (or take their section) when not', () => {
  const ref = (imageId, alt = 'Alt') => ({ imageId, alt });
  const landing = {
    ...emptyLanding(),
    photo: 'upload',
    photoImage: ref(IMG, 'Jo'),
    sections: [
      { id: 'i', kind: 'items', title: '', items: [{ title: 'P', text: '', url: '', image: ref(IMG) }, { title: 'Q', text: '', url: '', image: ref(IMG2) }] },
      { id: 'pic', kind: 'image', title: 'Me', image: ref(IMG), caption: 'Hi' },
      { id: 'gone', kind: 'image', title: 'Gone', image: ref(IMG2), caption: 'Bye' },
      { id: 'none', kind: 'image', title: 'Not yet', image: null, caption: '' },
    ],
    seo: { title: '', description: '', noindex: false, image: ref(IMG, 'Card') },
  };
  const src = `/api/public/landing/images/${IMG}`;
  const context = { photoUrl: 'data:image/jpeg;base64,AAAA', site: null, resumes: new Map(), images: new Map([[IMG, { src, width: 1200, height: 630 }]]) };
  const out = resolveLanding(landing, context);
  const shown = { src, alt: 'Alt', width: 1200, height: 630 };
  assert.equal(out.photoUrl, src);
  assert.equal(out.photoAlt, 'Jo');
  assert.deepEqual(out.sections, [
    { kind: 'items', title: '', items: [{ title: 'P', text: '', url: '', image: shown }, { title: 'Q', text: '', url: '' }] },
    { kind: 'image', title: 'Me', image: shown, caption: 'Hi' },
  ]);
  assert.deepEqual(out.seo, { title: '', description: '', noindex: false, image: { ...shown, alt: 'Card' } });
  assert.equal(JSON.stringify(out).includes('imageId'), false);
  assert.deepEqual([...shownImageIds(out)], [IMG]);

  // Its image gone: no photo, no share image.
  const bare = resolveLanding(landing, { ...context, images: new Map() });
  assert.equal(bare.photoUrl, '');
  assert.equal('photoAlt' in bare, false);
  assert.deepEqual(bare.seo, { title: '', description: '', noindex: false });
  assert.deepEqual([...shownImageIds(bare)], []);
  // photoImage only counts with photo: 'upload'; a context without images is fine.
  assert.equal(resolveLanding({ ...landing, photo: 'resume' }, context).photoUrl, context.photoUrl);
  assert.equal(resolveLanding({ ...landing, photo: 'none' }, { resumes: new Map() }).photoUrl, '');
});

test('only an uploaded image path counts as one', () => {
  assert.equal(imageIdOfPath(`/api/public/landing/images/${IMG}`), IMG);
  for (const other of [`/api/landing/images/${IMG}`, `/api/public/landing/images/${IMG}/x`, 'data:image/png;base64,AA', '', null]) {
    assert.equal(imageIdOfPath(other), null);
  }
  assert.deepEqual(resolveImage({ imageId: IMG, alt: 7 }, new Map([[IMG, { src: 's', width: 1, height: 2 }]])), { src: 's', alt: '', width: 1, height: 2 });
  assert.equal(resolveImage(null, new Map()), null);
  assert.equal(checkImageRef({ imageId: IMG, alt: 'a' }, 'x', withImages(IMG)).alt, 'a');
});

test('an image the page would show needs a description to publish', () => {
  const stored = new Set([IMG]);
  const ref = (alt, imageId = IMG) => ({ imageId, alt });
  const fieldOf = (landing) => {
    try {
      assertImagesDescribed(landing, stored);
    } catch (err) {
      assert.equal(err.status, 400);
      return err.message.match(/\(([^)]*\.alt)\)/)[1];
    }
    return null;
  };
  const items = (...list) => ({ id: 'i', kind: 'items', title: '', items: list });
  assert.equal(fieldOf(emptyLanding()), null);
  assert.equal(fieldOf({ ...emptyLanding(), photo: 'upload', photoImage: ref('') }), 'photoImage.alt');
  assert.equal(fieldOf({ ...emptyLanding(), photo: 'resume', photoImage: ref('') }), null);
  assert.equal(fieldOf({ ...emptyLanding(), sections: [items({ title: 'P', text: '', url: '', image: ref(' \n') })] }), 'sections[0].items[0].image.alt');
  // An item with nothing to show isn't shown, thumbnail and all.
  assert.equal(fieldOf({ ...emptyLanding(), sections: [items({ title: ' ', text: '', url: '', image: ref('') })] }), null);
  assert.equal(fieldOf({ ...emptyLanding(), sections: [{ id: 't', kind: 'text', title: '', body: 'x' }, { id: 'p', kind: 'image', title: '', image: ref(''), caption: '' }] }), 'sections[1].image.alt');
  assert.equal(fieldOf({ ...emptyLanding(), sections: [{ id: 'p', kind: 'image', title: '', image: null, caption: '' }] }), null);
  // Nor anything in a hidden section.
  assert.equal(fieldOf({ ...emptyLanding(), sections: [{ id: 'p', kind: 'image', title: '', hidden: true, image: ref(''), caption: '' }] }), null);
  assert.equal(fieldOf({ ...emptyLanding(), sections: [{ ...items({ title: 'P', text: '', url: '', image: ref('') }), hidden: true }] }), null);
  assert.equal(fieldOf({ ...emptyLanding(), seo: { title: '', description: '', noindex: false, image: ref('') } }), 'seo.image.alt');
  // One whose image is gone shows nothing, so it doesn't block a publish.
  assert.equal(fieldOf({ ...emptyLanding(), seo: { title: '', description: '', noindex: false, image: ref('', IMG2) } }), null);
  assert.equal(fieldOf({ ...emptyLanding(), photo: 'upload', photoImage: ref('Jo'), seo: { title: '', description: '', noindex: false, image: ref('Card') } }), null);
  assert.throws(
    () => assertImagesDescribed({ ...emptyLanding(), photo: 'upload', photoImage: ref(''), seo: { image: ref('') } }, stored),
    /the photo has no description \(photoImage\.alt\) \(and 1 more\)/
  );
});

test('credentials are checked strictly, field by field, and stored whole', () => {
  const credentials = (list) => ({ sections: [{ id: 'c', kind: 'credentials', title: 'Licenses', credentials: list }] });
  const rn = {
    kind: 'license',
    name: 'Registered Nurse',
    issuer: 'Oregon State Board of Nursing',
    number: '095012345RN',
    issued: '2019',
    expires: 'Dec 2027',
    url: 'https://osbn.example/verify',
  };
  const draft = validateLanding(credentials([rn, { name: 'ServSafe' }]), known());
  assert.deepEqual(draft.sections[0], {
    id: 'c',
    kind: 'credentials',
    title: 'Licenses',
    credentials: [rn, { kind: 'certification', name: 'ServSafe', issuer: '', number: '', issued: '', expires: '', url: '' }],
  });
  for (const kind of ['license', 'certification', 'membership']) {
    assert.equal(validateLanding(credentials([{ kind, name: 'X' }]), known()).sections[0].credentials[0].kind, kind);
  }
  // At every cap is fine.
  const atCaps = {
    name: 'n'.repeat(LANDING_LIMITS.credentialName),
    issuer: 'i'.repeat(LANDING_LIMITS.credentialIssuer),
    number: '1'.repeat(LANDING_LIMITS.credentialNumber),
    issued: 'd'.repeat(LANDING_LIMITS.credentialDate),
    expires: 'd'.repeat(LANDING_LIMITS.credentialDate),
    url: 'mailto:board@osbn.example',
  };
  assert.equal(status(() => validateLanding(credentials(Array.from({ length: LANDING_LIMITS.credentials }, () => atCaps)), known())), null);

  const bad = [
    credentials([{ name: 'x'.repeat(LANDING_LIMITS.credentialName + 1) }]),
    credentials([{ name: 'X', issuer: 'x'.repeat(LANDING_LIMITS.credentialIssuer + 1) }]),
    credentials([{ name: 'X', number: '1'.repeat(LANDING_LIMITS.credentialNumber + 1) }]),
    credentials([{ name: 'X', issued: 'x'.repeat(LANDING_LIMITS.credentialDate + 1) }]),
    credentials([{ name: 'X', expires: 'x'.repeat(LANDING_LIMITS.credentialDate + 1) }]),
    credentials([{ name: 'X', url: 'x'.repeat(LANDING_LIMITS.url + 1) }]),
    credentials([{ name: 'X', url: 'java\tscript:alert(1)' }]),
    credentials([{ name: 'X', url: 'data:text/html,hi' }]),
    credentials([{ kind: 'degree', name: 'X' }]),
    credentials([{ kind: 'License', name: 'X' }]),
    credentials([{ name: 'X', state: 'OR' }]),
    credentials([{ name: 5 }]),
    credentials([{ name: 'X', expires: 2027 }]),
    credentials(['Registered Nurse']),
    credentials('RN'),
    credentials(Array.from({ length: LANDING_LIMITS.credentials + 1 }, () => ({ name: 'X' }))),
    { sections: [{ id: 'c', kind: 'credentials', items: [] }] },
  ];
  for (const input of bad) assert.equal(status(() => validateLanding(input, known())), 400, JSON.stringify(input).slice(0, 80));
  // A half-typed link saves, and isn't shown.
  const half = validateLanding(credentials([{ name: 'X', url: 'https://' }]), known());
  assert.equal(resolveLanding(half, { resumes: new Map(), today: '2026-11-10' }).sections[0].credentials[0].url, '');
});

test('a credential leaves the page once it has expired, read against today; an unreadable date stays as written', () => {
  const entry = (name, expires) => ({ kind: 'certification', name, issuer: 'Board', number: '', issued: '', expires, url: '' });
  const landing = validateLanding(
    {
      sections: [
        {
          id: 'c',
          kind: 'credentials',
          title: 'Certifications',
          column: 'side',
          credentials: [
            entry('Lapsed', '10/2026'),
            entry('This month', 'November 2026'),
            entry('This year', '2026'),
            entry('No expiry', ''),
            entry('Unreadable', 'Renewed yearly'),
            entry('Yesterday', '2026-11-09'),
            entry(' ', '2030'),
          ],
        },
        { id: 'old', kind: 'credentials', title: 'Old ones', credentials: [entry('A', '2020'), entry('B', 'Jan 2025')] },
        { id: 'none', kind: 'credentials', title: 'Empty', credentials: [] },
        { id: 'hid', kind: 'credentials', title: 'Hidden', hidden: true, credentials: [entry('C', '')] },
      ],
    },
    known()
  );
  const shown = (today) => resolveLanding(landing, { resumes: new Map(), today }).sections;
  assert.deepEqual(shown('2026-11-10'), [
    {
      kind: 'credentials',
      title: 'Certifications',
      column: 'side',
      credentials: [entry('This month', 'November 2026'), entry('This year', '2026'), entry('No expiry', ''), entry('Unreadable', 'Renewed yearly')],
    },
  ]);
  // A month later, without a republish, the month's goes; the year's after the new year.
  assert.deepEqual(shown('2026-12-01')[0].credentials.map((c) => c.name), ['This year', 'No expiry', 'Unreadable']);
  assert.deepEqual(shown('2027-01-01')[0].credentials.map((c) => c.name), ['No expiry', 'Unreadable']);
  // Earlier, every dated one shows, and the section of old ones too (a section never has an id).
  assert.deepEqual(shown('2019-06-01').map((s) => s.title), ['Certifications', 'Old ones']);
  assert.ok(shown('2019-06-01').every((s) => !('id' in s)));
  // Without a today of its own, it's read against the clock (in UTC).
  assert.deepEqual(
    resolveLanding(landing, { resumes: new Map() }).sections[0].credentials.slice(-2).map((c) => c.name),
    ['No expiry', 'Unreadable']
  );
});
