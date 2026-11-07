import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANDING_LIMITS,
  cardResumeIds,
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
  assert.deepEqual(validateLanding(cards([{ resumeId: 'a' }]), known('a')).sections[0].cards, [{ resumeId: 'a', label: '', blurb: '' }]);
  assert.equal(status(() => validateLanding(cards([{ resumeId: 'gone' }]), known('a'))), 400);
  const kept = validateLanding(cards([{ resumeId: 'gone' }]), { knownResumeIds: new Set(['a']), previousResumeIds: new Set(['gone']) });
  assert.equal(kept.sections[0].cards[0].resumeId, 'gone');
  assert.equal(status(() => validateLanding(cards([{ resumeId: 'a' }, { resumeId: 'a' }]), known('a'))), 400);
  assert.equal(status(() => validateLanding(cards([{ label: 'x' }]), known('a'))), 400);
  // Two sections may each have a card for the same resume.
  const both = validateLanding({ sections: [cardsSection([{ resumeId: 'a' }], 'c1'), cardsSection([{ resumeId: 'a' }], 'c2')] }, known('a'));
  assert.deepEqual([...cardResumeIds(both)], ['a']);
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
    photo: 'resume',
    photoUrl: '',
    publishedAt: '2026-11-06T00:00:00.000Z',
    sections: [
      { id: 'intro', kind: 'text', title: '', body: 'Hi' },
      { id: 'links', kind: 'links', title: '', links: old.links },
      { id: 'resumes', kind: 'resumes', title: '', cards: old.resumes },
    ],
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
    { id: 'resumes', kind: 'resumes', title: '', cards: [{ resumeId: 'main', label: '', blurb: '' }] },
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
