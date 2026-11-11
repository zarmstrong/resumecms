import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { createSettings } from './settings.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LANDING_TEXT_FORMAT_KEY, escapeLandingText, migrateLandingText, splitTextFormat } from './landingTextMigration.js';
import { createResumeStore } from './resumeStore.js';
import { migrateToResumes } from './resumeMigration.js';
import { inlinePlainText, parseInline, textParagraphs } from './inlineText.js';
import { LANDING_LIMITS, upgradeLanding, validateLanding } from './landingFields.js';

function makeDb() {
  const db = new Database(':memory:');
  ensureSchema(db);
  return { db, ...createSettings(db) };
}

const landing = (body, itemText) => ({
  headline: '**Jo**',
  subheadline: '',
  availability: '',
  actions: [],
  photo: 'none',
  photoUrl: '',
  sections: [
    { id: 'intro', kind: 'text', title: '*Hi*', body },
    { id: 'items', kind: 'items', title: '', items: [{ title: '', text: itemText, url: '' }] },
    { id: 'links', kind: 'links', title: '', links: [{ label: '[x](y)', url: 'https://x.example' }] },
  ],
  seo: { title: '', description: '', noindex: false },
});

// What a visitor reads of a text section, paragraph by paragraph.
const readsAs = (body) => textParagraphs(body).map((p) => inlinePlainText(parseInline(p)));

test('stored text is escaped once so it reads as it did, and never again', () => {
  const { db, getSetting, setSetting } = makeDb();
  const body = 'Rated 5 *stars* by [my team](v2).\n\nA plain paragraph, 5* hotel.';
  setSetting('landing_draft', landing(body, 'C:\\*temp*'));
  setSetting('landing_published', { ...landing('**old**', 'plain'), publishedAt: '2026-01-01T00:00:00.000Z' });
  setSetting('landing_meta', { lastEditedAt: null });

  assert.equal(migrateLandingText(db), 3);
  const draft = getSetting('landing_draft');
  assert.deepEqual(readsAs(draft.sections[0].body), ['Rated 5 *stars* by [my team](v2).', 'A plain paragraph, 5* hotel.']);
  assert.deepEqual(parseInline(draft.sections[1].items[0].text), [{ t: 'text', text: 'C:\\*temp*' }]);
  // Only the two fields that hold the syntax: titles, headlines and links are plain text anyway.
  assert.equal(draft.headline, '**Jo**');
  assert.equal(draft.sections[0].title, '*Hi*');
  assert.equal(draft.sections[2].links[0].label, '[x](y)');
  const published = getSetting('landing_published');
  assert.equal(published.sections[0].body, '\\*\\*old\\*\\*');
  assert.equal(published.sections[1].items[0].text, 'plain');
  assert.equal(published.publishedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(getSetting('landing_meta'), { lastEditedAt: null });
  assert.equal(getSetting(LANDING_TEXT_FORMAT_KEY), 'inline');

  // Every later boot leaves it alone, and so text written with the syntax since.
  setSetting('landing_draft', landing('Now **bold**', ''));
  assert.equal(migrateLandingText(db), 0);
  assert.equal(getSetting('landing_draft').sections[0].body, 'Now **bold**');
  assert.equal(getSetting('landing_published').sections[0].body, '\\*\\*old\\*\\*');
});

test('a draft that saved before the escape still saves after it, even at its caps', () => {
  const { db, getSetting, setSetting } = makeDb();
  const body = 'x'.repeat(3990) + ' *a* *b*';
  const itemText = 'x'.repeat(992) + ' *a* *b*';
  assert.equal(body.length, 3998);
  assert.equal(itemText.length, LANDING_LIMITS.itemText);
  const stored = validateLanding(landing(body, itemText), { knownResumeIds: new Set() });
  setSetting('landing_draft', stored);
  setSetting('landing_published', { ...stored, publishedAt: '2026-01-01T00:00:00.000Z' });

  assert.equal(migrateLandingText(db), 4);
  for (const key of ['landing_draft', 'landing_published']) {
    const { publishedAt, ...escaped } = getSetting(key);
    // Longer as written, by the backslashes, which the caps don't count.
    assert.equal(escaped.sections[0].body.length, 4002);
    assert.equal(escaped.sections[1].items[0].text.length, LANDING_LIMITS.itemText + 4);
    assert.deepEqual(validateLanding(escaped, { knownResumeIds: new Set() }), escaped, key);
    assert.deepEqual(readsAs(escaped.sections[0].body), [body]);
  }
  // A character more than the cap is still too long, escaped or not.
  const draft = getSetting('landing_draft');
  const over = { ...draft, sections: [{ ...draft.sections[0], body: `${draft.sections[0].body}xxx` }, draft.sections[1]] };
  assert.throws(() => validateLanding(over, { knownResumeIds: new Set() }), { status: 400, message: /too long/ });
});

test('text that already reads as written is left as it is', () => {
  const { db, getSetting, setSetting } = makeDb();
  const stored = landing('Plain, with a 5* rating and a stray ] bracket.', 'Also plain.');
  setSetting('landing_draft', stored);
  assert.equal(migrateLandingText(db), 0);
  assert.deepEqual(getSetting('landing_draft'), stored);
  assert.equal(getSetting(LANDING_TEXT_FORMAT_KEY), 'inline');
});

test('a fresh install has nothing to escape and is marked done', () => {
  const { db, getSetting } = makeDb();
  assert.equal(migrateLandingText(db), 0);
  assert.equal(getSetting('landing_draft'), null);
  assert.equal(getSetting('landing_published'), null);
  assert.equal(getSetting(LANDING_TEXT_FORMAT_KEY), 'inline');
});

test('a draft stored before sections has its intro escaped', () => {
  const { db, getSetting, setSetting } = makeDb();
  setSetting('landing_draft', { headline: 'Jo', subheadline: '', photo: 'none', photoUrl: '', intro: 'I *was* here', links: [], resumes: [] });
  assert.equal(migrateLandingText(db), 1);
  const upgraded = upgradeLanding(getSetting('landing_draft'));
  assert.deepEqual(readsAs(upgraded.sections[0].body), ['I *was* here']);
});

// What PUT /api/landing and the rewrite route do with a body
// (routes/landing.js, routes/ai.js), over the real store.
function makeStore() {
  const { db, ...settings } = makeDb();
  migrateToResumes(db);
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-landing-text-'));
  const store = createResumeStore({ db, pdfDir, renderPdf: async () => Buffer.from('%PDF-fake') });
  const put = (body) => {
    const { landing, textFormat } = splitTextFormat(body);
    return store.setLanding(landing, { textFormat });
  };
  const rewriteCopy = (copy) => {
    const { landing, textFormat } = splitTextFormat(copy);
    return store.checkLandingDraft(landing, { textFormat });
  };
  return { db, store, put, rewriteCopy, ...settings };
}

test('an editor tab loaded before the upgrade saves plain text that reads as it did', () => {
  const { db, store, put, rewriteCopy, setSetting } = makeStore();
  const body = '5 *stars* hotel, see [v2](draft).\n\nNo markers here.';
  const itemText = 'Old [x](javascript:alert(1)) text';
  // Written by the old server, and held by a tab that loaded it then.
  setSetting('landing_draft', landing(body, itemText));
  const staleTab = store.getLanding();
  migrateLandingText(db);
  const migrated = store.getLanding();

  // The tab's next save, without the marker: escaped, not a 400, and the same as the migration made it.
  const saved = put({ ...staleTab, headline: 'Jo' });
  assert.deepEqual(readsAs(saved.sections[0].body), ['5 *stars* hotel, see [v2](draft).', 'No markers here.']);
  assert.deepEqual(parseInline(saved.sections[1].items[0].text), [{ t: 'text', text: itemText }]);
  assert.deepEqual(saved.sections, migrated.sections);
  assert.equal(saved.headline, 'Jo');
  // Its rewrite requests take the same reading.
  assert.deepEqual(rewriteCopy(staleTab).sections, migrated.sections);
  // What it publishes shows as plain text.
  store.publishLanding();
  store.setLandingEnabled(true);
  const shown = store.shownLanding().sections.find((section) => section.kind === 'text');
  assert.deepEqual(readsAs(shown.body), ['5 *stars* hotel, see [v2](draft).', 'No markers here.']);

  // A current editor's save is marked: read back and saved again, nothing changes, and new syntax is kept.
  const current = store.getLanding();
  assert.deepEqual(put({ ...current, textFormat: 'inline' }).sections, current.sections);
  const formatted = put({ ...current, sections: [{ ...current.sections[0], body: 'At **Acme**' }, current.sections[1]], textFormat: 'inline' });
  assert.equal(formatted.sections[0].body, 'At **Acme**');
  assert.ok(!('textFormat' in store.getLanding()));
  // An unsafe link only fails a marked write.
  const unsafe = { ...current, sections: [{ ...current.sections[0], body: '[x](javascript:alert(1))' }] };
  assert.equal(status(() => put({ ...unsafe, textFormat: 'inline' })), 400);
  assert.equal(status(() => rewriteCopy({ ...unsafe, textFormat: 'inline' })), 400);
  assert.equal(put(unsafe).sections[0].body, '\\[x\\](javascript:alert(1))');

  // The MCP tool merges as inline: its descriptions document the syntax.
  assert.equal(store.setLanding({ headline: '**Jo**', sections: [{ id: 'intro', kind: 'text', body: '*Hi*' }] }, { merge: true }).sections[0].body, '*Hi*');
});

test('an old editor tab that re-reads the escaped draft saves it back without escaping it again', async () => {
  const { db, store, put, rewriteCopy, setSetting } = makeStore();
  setSetting('landing_draft', landing('Rated 5 *stars*', 'C:\\*temp*'));
  migrateLandingText(db);
  const migrated = store.getLanding();
  assert.equal(migrated.sections[0].body, 'Rated 5 \\*stars\\*');

  // Remounting the page GETs the draft; editing only the headline, twice over.
  for (const headline of ['Jo', 'Jo Doe']) {
    const reread = store.getLanding();
    const saved = put({ ...reread, headline });
    assert.deepEqual(saved.sections, migrated.sections, headline);
    assert.deepEqual(rewriteCopy(reread).sections, migrated.sections, headline);
  }
  // Discard puts the published snapshot into the tab's state.
  store.publishLanding();
  put({ ...store.getLanding(), headline: 'Edited' });
  const discarded = store.discardLandingDraft();
  assert.deepEqual(put({ ...discarded, headline: 'Again' }).sections, migrated.sections);
  store.publishLanding();
  store.setLandingEnabled(true);
  assert.deepEqual(readsAs(store.shownLanding().sections[0].body), ['Rated 5 *stars*']);

  // A field it did change is escaped: it reads as that tab showed it, backslashes and all.
  const edited = store.getLanding();
  const saved = put({ ...edited, sections: [{ ...edited.sections[0], body: `${edited.sections[0].body} *today*` }, ...edited.sections.slice(1)] });
  assert.deepEqual(readsAs(saved.sections[0].body), ['Rated 5 \\*stars\\* *today*']);
  // An item moved within its section still matches.
  const items = edited.sections[1];
  const moved = put({ ...edited, sections: [{ ...items, items: [{ title: 'new', text: 'x', url: '' }, ...items.items] }] });
  assert.equal(moved.sections[0].items[1].text, items.items[0].text);
});

test("an old tab's items keep their meaning when one differs from another only by escapes", () => {
  const reads = (out) => out.sections[0].items.map((item) => inlinePlainText(parseInline(item.text)));
  const items = (...texts) => ({ sections: [{ id: 'i', kind: 'items', title: '', items: texts.map((text, i) => ({ title: `${i}`, text, url: '' })) }] });
  // Before the upgrade: A has markers, B has the backslashes typed out.
  const before = items('rated *5*', 'rated \\*5\\*');
  const stored = escapeLandingText(before).landing;
  assert.deepEqual(reads(stored), ['rated *5*', 'rated \\*5\\*']);
  // A tab that never re-read sends both as it had them, or moves the one
  // whose escaped form no other item's stored text is. (Moving B into A's
  // place can't be told from echoing A there, so the echo wins.)
  assert.deepEqual(escapeLandingText(before, stored).landing, stored);
  assert.deepEqual(reads(escapeLandingText(items('new', 'rated *5*', 'rated \\*5\\*'), stored).landing), ['new', 'rated *5*', 'rated \\*5\\*']);
  // A tab that re-read echoes the stored text in place.
  const [a, b] = stored.sections[0].items.map((item) => item.text);
  assert.deepEqual(escapeLandingText(items(a, b), stored).landing, stored);

  // An echo moved off its place still matches, and an original moved still gets escaped.
  const others = escapeLandingText(items('**Acme**', 'plain', 'C:\\temp')).landing;
  const [acme, plain, path] = others.sections[0].items.map((item) => item.text);
  assert.deepEqual(reads(escapeLandingText(items('new *one*', path, acme, plain), others).landing), ['new *one*', 'C:\\temp', '**Acme**', 'plain']);
  assert.deepEqual(reads(escapeLandingText(items('new', '**Acme**'), others).landing), ['new', '**Acme**']);
  // What can't be told apart: with two items that differ only by escapes,
  // A's echo moved onto B's place is the very text B had before the upgrade,
  // so it's read as B's.
});

test('a plain write keeps a field only where it equals the stored one', () => {
  const stored = landing('a \\*b\\*', '\\*x\\*');
  const write = { ...stored, sections: [...stored.sections, { id: 'other', kind: 'text', title: '', body: 'a \\*b\\*' }] };
  const { landing: out, changed } = escapeLandingText(write, stored);
  assert.equal(changed, 1);
  assert.equal(out.sections[0].body, 'a \\*b\\*');
  assert.equal(out.sections[1].items[0].text, '\\*x\\*');
  assert.equal(out.sections[3].body, 'a \\\\\\*b\\\\\\*');
  // Text from elsewhere on the page, or a section of another kind under the same id, doesn't match.
  const copied = { ...stored, sections: [{ ...stored.sections[1], items: [{ title: '', text: 'a \\*b\\*', url: '' }] }] };
  assert.equal(escapeLandingText(copied, stored).landing.sections[0].items[0].text, 'a \\\\\\*b\\\\\\*');
  const retyped = { ...stored, sections: [{ id: 'items', kind: 'text', title: '', body: '\\*x\\*' }] };
  assert.equal(escapeLandingText(retyped, stored).landing.sections[0].body, '\\\\\\*x\\\\\\*');
});

test('only an inline marker is accepted, and it never reaches validation', () => {
  assert.deepEqual(splitTextFormat({ headline: 'a', textFormat: 'inline' }), { landing: { headline: 'a' }, textFormat: 'inline' });
  assert.deepEqual(splitTextFormat({ headline: 'a' }), { landing: { headline: 'a' }, textFormat: 'plain' });
  for (const body of [null, undefined, 'x', [1]]) assert.deepEqual(splitTextFormat(body), { landing: body, textFormat: 'plain' });
  for (const textFormat of ['plain', 'markdown', null, true]) assert.equal(status(() => splitTextFormat({ textFormat })), 400, String(textFormat));
  // Escaping leaves what isn't text for validation to judge.
  assert.deepEqual(escapeLandingText({ sections: [null, { kind: 'text', body: 3 }, { kind: 'items', items: 'x' }] }).landing, {
    sections: [null, { kind: 'text', body: 3 }, { kind: 'items', items: 'x' }],
  });
});

function status(fn) {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
  return null;
}

test('escaping keeps every image reference: an item thumbnail, an image section and its caption', () => {
  const image = { imageId: 'a'.repeat(64), alt: 'A *starred* alt' };
  const landing = {
    headline: 'Jo',
    photo: 'upload',
    photoImage: image,
    sections: [
      { id: 'i', kind: 'items', title: '', items: [{ title: 'P', text: 'Uses *this* tool', url: '', meta: '2024', image }] },
      { id: 'pic', kind: 'image', title: '', image, caption: 'Plain *caption*' },
    ],
    seo: { title: '', description: '', noindex: false, image },
  };
  const { landing: out, changed } = escapeLandingText(landing);
  assert.equal(changed, 1);
  assert.deepEqual(out.sections[0].items[0], { title: 'P', text: 'Uses \\*this\\* tool', url: '', meta: '2024', image });
  // Captions and alt text are plain text: never escaped.
  assert.deepEqual(out.sections[1], landing.sections[1]);
  assert.deepEqual([out.photoImage, out.seo.image], [image, image]);
  // Against a stored draft (a plain write, keepItem()), moved or echoed.
  const stored = { ...landing, sections: [{ ...landing.sections[0], items: [{ ...landing.sections[0].items[0], text: 'Uses \\*this\\* tool' }] }] };
  const echoed = escapeLandingText({ ...landing, sections: [{ ...landing.sections[0], items: [{ ...stored.sections[0].items[0] }] }] }, stored).landing;
  assert.deepEqual(echoed.sections[0].items[0].image, image);
});

test('a plain write escapes an FAQ answer it changed, keeps one it echoed, and never touches a question', () => {
  const { store, put } = makeStore();
  const faq = (entries) => ({ id: 'faq', kind: 'faq', title: '', entries });
  // Written with the syntax (MCP, a current editor), then echoed by a tab without the marker.
  const stored = store.setLanding({
    headline: 'Jo',
    sections: [faq([{ question: 'Do you *travel*?', answer: 'Yes, **often**. [More](https://jo.example)' }, { question: 'B?', answer: 'b \\*x\\*' }])],
  });
  assert.deepEqual(put({ ...stored, headline: 'Jo Doe' }).sections, stored.sections);
  // Moved, the echoes still match their stored answers.
  const [first, second] = stored.sections[0].entries;
  assert.deepEqual(put({ ...stored, sections: [faq([second, first])] }).sections[0].entries, [second, first]);
  // An edited answer reads as that tab showed it; the question stays plain text, as written.
  const edited = put({ ...stored, sections: [faq([{ question: 'Do you *travel*?', answer: 'Yes, *sometimes*.' }])] });
  assert.deepEqual(edited.sections[0].entries[0], { question: 'Do you *travel*?', answer: 'Yes, \\*sometimes\\*.' });
  assert.deepEqual(parseInline(edited.sections[0].entries[0].answer), [{ t: 'text', text: 'Yes, *sometimes*.' }]);
  // A marked write is taken as written.
  assert.equal(put({ ...stored, sections: [faq([{ question: 'Q', answer: '*Now*' }])], textFormat: 'inline' }).sections[0].entries[0].answer, '*Now*');
  // What isn't text is left for validation.
  const odd = { sections: [{ kind: 'faq', entries: 'x' }, { kind: 'faq', entries: [null, { answer: 3 }] }] };
  assert.deepEqual(escapeLandingText(odd).landing, odd);
});

test("a plain write escapes a service's text it changed, keeps one it echoed, and never touches its title, price or button", () => {
  const { store, put } = makeStore();
  const services = (list) => ({ id: 'sv', kind: 'services', title: '', services: list });
  const action = { type: 'link', label: '*Book*', url: 'mailto:jo@example.com?subject=Booking' };
  // Written with the syntax (MCP, a current editor), then echoed by a tab without the marker.
  const stored = store.setLanding({
    headline: 'Jo',
    sections: [
      services([
        { title: '*Tutoring*', text: 'One-to-one, **weekly**. [Syllabus](https://jo.example)', price: '*$60*/hour', action },
        { title: 'Consult', text: 'c \\*x\\*', price: '' },
      ]),
    ],
  });
  assert.deepEqual(put({ ...stored, headline: 'Jo Doe' }).sections, stored.sections);
  // Moved, the echoes still match their stored services.
  const [first, second] = stored.sections[0].services;
  assert.deepEqual(put({ ...stored, sections: [services([second, first])] }).sections[0].services, [second, first]);
  // An edited text reads as that tab showed it; the rest stays plain text, as written.
  const edited = put({ ...stored, sections: [services([{ ...first, text: 'Weekly, *in person*.' }])] });
  assert.deepEqual(edited.sections[0].services[0], { ...first, text: 'Weekly, \\*in person\\*.' });
  assert.deepEqual(parseInline(edited.sections[0].services[0].text), [{ t: 'text', text: 'Weekly, *in person*.' }]);
  // A marked write is taken as written.
  assert.equal(put({ ...stored, sections: [services([{ title: 'T', text: '*Now*' }])], textFormat: 'inline' }).sections[0].services[0].text, '*Now*');
  // What isn't text is left for validation.
  const odd = { sections: [{ kind: 'services', services: 'x' }, { kind: 'services', services: [null, { text: 3 }] }] };
  assert.deepEqual(escapeLandingText(odd).landing, odd);
});
