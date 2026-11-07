import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { createResumeStore } from './resumeStore.js';
import { migrateToResumes } from './resumeMigration.js';
import { createSettings } from './settings.js';

// The landing page (issue #70) through the real store over ':memory:', as
// resumeStore.test.js does for resumes.

async function makeStore() {
  const db = new Database(':memory:');
  ensureSchema(db);
  const defaultId = migrateToResumes(db);
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-landing-'));
  const store = createResumeStore({ db, pdfDir, renderPdf: async () => Buffer.from('%PDF-fake') });
  store.setHeader({ name: 'Jo', title: 'Engineer', photoUrl: 'data:image/jpeg;base64,PUB', links: [{ label: 'gh', url: 'https://github.com/jo' }] });
  store.setSite({ title: 'Jo', colors: { accent: '#123456' } });
  await store.publish();
  return { db, store, defaultId };
}

async function publicResume(store, name, slug) {
  const { id } = store.createResume({ name, slug });
  store.forResume(id).setHeader({ name: 'Jo', title: `${name} title` });
  await store.forResume(id).publish();
  store.updateResume(id, { isPublic: true });
  return id;
}

const cardsOf = (landing) => landing.sections.find((s) => s.kind === 'resumes')?.cards;

const status = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

test('before anything is saved, the draft comes from the published header', async () => {
  const { store, defaultId } = await makeStore();
  // An unpublished header edit must not leak into it.
  store.setHeader({ name: 'Draft name', title: 'Draft title' });
  const draft = store.getLanding();
  assert.equal(draft.headline, 'Jo');
  assert.equal(draft.subheadline, 'Engineer');
  assert.deepEqual(cardsOf(draft), [{ resumeId: defaultId, label: '', blurb: '' }]);
  assert.deepEqual(store.getLandingStatus(), { enabled: false, publishedAt: null, isDirty: false });
});

test('saving marks the landing page dirty, publishing clears it, and neither touches the resume', async () => {
  const { store } = await makeStore();
  const resumeStatus = store.getPublishStatus();
  store.setLanding({ headline: 'Hello' });
  assert.equal(store.getLandingStatus().isDirty, true);
  assert.equal(store.getPublishStatus().isDirty, resumeStatus.isDirty);
  const after = store.publishLanding();
  assert.equal(after.isDirty, false);
  assert.ok(after.publishedAt);
  assert.equal(store.getPublishStatus().publishedAt, resumeStatus.publishedAt);

  store.setLanding({ headline: 'Changed' });
  assert.equal(store.getLandingStatus().isDirty, true);
  assert.equal(store.discardLandingDraft().headline, 'Hello');
  assert.equal(store.getLanding().headline, 'Hello');
  assert.equal(store.getLandingStatus().isDirty, false);
});

test('discard before any publish is a 409; merge keeps the other fields', async () => {
  const { store } = await makeStore();
  assert.equal(status(() => store.discardLandingDraft()), 409);
  store.setLanding({ headline: 'A', subheadline: 'B', sections: [{ id: 't', kind: 'text', body: 'Hi' }] });
  const merged = store.setLanding({ headline: 'C', subheadline: null }, { merge: true });
  assert.equal(merged.headline, 'C');
  assert.equal(merged.subheadline, '');
  assert.deepEqual(merged.sections, [{ id: 't', kind: 'text', title: '', body: 'Hi' }]);
  // REST replaces: what isn't sent is reset.
  assert.equal(store.setLanding({ subheadline: 'only' }).headline, '');
  const bad = { sections: [{ kind: 'links', links: [{ label: 'x', url: 'javascript:alert(1)' }] }] };
  assert.equal(status(() => store.setLanding(bad)), 400);
});

test('the landing page shows only when enabled and published, and never on a resume domain', async () => {
  const { store } = await makeStore();
  const salesId = await publicResume(store, 'Sales', 'sales');
  store.updateResume(salesId, { hostnames: ['sales.example.com'] });
  const draftId = store.createResume({ name: 'Unpublished' }).id;

  assert.equal(store.landingForHost('example.com'), null); // off, unpublished
  store.setLandingEnabled(true);
  assert.equal(store.landingForHost('example.com'), null); // on, unpublished
  store.publishLanding();
  assert.equal(store.landingForHost('example.com').headline, 'Jo');
  assert.equal(store.landingForHost('EXAMPLE.com.').headline, 'Jo');
  assert.equal(store.landingForHost('sales.example.com'), null);

  // A domain whose resume can't be shown (unpublished) falls back to the
  // default resume there, as before, not to the landing page.
  store.updateResume(draftId, { hostnames: ['draft.example.com'] });
  assert.equal(store.landingForHost('draft.example.com'), null);

  store.setLandingEnabled(false);
  assert.equal(store.landingForHost('example.com'), null);
  assert.equal(status(() => store.setLandingEnabled('yes')), 400);
});

test('cards are resolved at request time: private, unpublished and deleted resumes drop off', async () => {
  const { store, defaultId } = await makeStore();
  const salesId = await publicResume(store, 'Sales', 'sales');
  const hiddenId = store.createResume({ name: 'Acme – tailored for Jane' }).id;
  store.setLanding({
    headline: 'Jo',
    sections: [
      {
        id: 'cards',
        kind: 'resumes',
        cards: [{ resumeId: defaultId }, { resumeId: salesId, blurb: 'For sales' }, { resumeId: hiddenId, label: '' }],
      },
      { id: 'more', kind: 'resumes', title: 'Also', cards: [{ resumeId: salesId }] },
    ],
  });
  store.setLandingEnabled(true);
  store.publishLanding();

  let page = store.landingForHost('example.com');
  assert.deepEqual(cardsOf(page), [
    { label: 'Engineer', blurb: '', href: '/resume' },
    { label: 'Sales title', blurb: 'For sales', href: '/r/sales' },
  ]);
  const body = JSON.stringify(page);
  assert.equal(body.includes(hiddenId), false);
  assert.equal(body.includes(salesId), false);
  assert.equal(body.includes('tailored for Jane'), false);

  store.updateResume(salesId, { slug: 'sales-2026' });
  assert.equal(cardsOf(store.landingForHost('example.com'))[1].href, '/r/sales-2026');

  store.updateResume(salesId, { isPublic: false });
  page = store.landingForHost('example.com');
  assert.deepEqual(cardsOf(page).map((c) => c.href), ['/resume']);
  // The second section had only that card, so it goes, heading and all.
  assert.equal(page.sections.length, 1);

  store.updateResume(salesId, { isPublic: true });
  store.deleteResume(salesId);
  assert.deepEqual(cardsOf(store.landingForHost('example.com')).map((c) => c.href), ['/resume']);
  // The draft still holds the deleted resume's cards and can still be saved,
  // even with one of them moved to another section.
  const draft = store.getLanding();
  const [first, second] = draft.sections;
  const moved = { ...draft, sections: [{ ...first, cards: first.cards.filter((c) => c.resumeId !== salesId) }, { ...second, cards: [first.cards[1]] }] };
  assert.equal(store.setLanding(moved).sections[1].cards[0].resumeId, salesId);
  // But a new card for an unknown id can't be added.
  const unknown = { ...draft, sections: [{ ...first, cards: [...first.cards, { resumeId: 'nope' }] }, second] };
  assert.equal(status(() => store.setLanding(unknown)), 400);
});

test("the page reuses the default resume's published photo and look, never its draft", async () => {
  const { store } = await makeStore();
  store.setLandingEnabled(true);
  store.publishLanding();
  store.setHeader({ name: 'Jo', photoUrl: 'data:image/jpeg;base64,DRAFT' });
  store.setSite({ title: 'Draft', colors: { accent: '#ff0000' } });
  const page = store.landingForHost('example.com');
  assert.equal(page.photoUrl, 'data:image/jpeg;base64,PUB');
  assert.equal(page.site.colors.accent, '#123456');
  const context = store.getLandingContext();
  assert.equal(context.photoUrl, 'data:image/jpeg;base64,PUB');
  assert.equal(JSON.stringify(context).includes('DRAFT'), false);
});

test('a draft and snapshot stored before sections still read, publish and discard', async () => {
  const { db, store, defaultId } = await makeStore();
  const { setSetting } = createSettings(db);
  const old = {
    headline: 'Old',
    subheadline: '',
    intro: 'Hello',
    photo: 'none',
    photoUrl: '',
    links: [{ label: 'gh', url: 'https://github.com/jo' }],
    resumes: [{ resumeId: defaultId, label: 'Main', blurb: '' }],
  };
  setSetting('landing_draft', old);
  setSetting('landing_published', { ...old, publishedAt: '2026-11-06T00:00:00.000Z' });
  store.setLandingEnabled(true);

  assert.deepEqual(store.landingForHost('example.com').sections.map((s) => s.kind), ['text', 'links', 'resumes']);
  const draft = store.getLanding();
  assert.deepEqual(draft.sections.map((s) => s.id), ['intro', 'links', 'resumes']);
  assert.equal('intro' in draft, false);
  // The editor sends back what it was given.
  assert.deepEqual(store.setLanding(draft), draft);
  assert.deepEqual(store.discardLandingDraft(), draft);
  store.publishLanding();
  assert.equal(store.landingForHost('example.com').sections[0].body, 'Hello');
});

test('checkLandingDraft validates like a save but stores nothing', async () => {
  const { store } = await makeStore();
  const before = store.getLandingStatus();
  const checked = store.checkLandingDraft({ headline: 'Copy', sections: [{ kind: 'text', body: 'Hi' }] });
  assert.equal(checked.headline, 'Copy');
  assert.equal(checked.sections[0].kind, 'text');
  assert.equal(store.getLanding().headline, 'Jo');
  assert.deepEqual(store.getLandingStatus(), before);
  assert.equal(status(() => store.checkLandingDraft({ headline: 1 })), 400);
  assert.equal(status(() => store.checkLandingDraft({ sections: [{ kind: 'resumes', cards: [{ resumeId: 'nope' }] }] })), 400);
});

test('visibleResumeSnapshot only returns a public, published resume', async () => {
  const { store, defaultId } = await makeStore();
  // The default is public and published: its snapshot, not its draft.
  store.setHeader({ name: 'Unpublished name' });
  assert.equal(store.visibleResumeSnapshot().header.name, 'Jo');
  assert.equal(store.visibleResumeSnapshot(defaultId).header.name, 'Jo');

  const publicId = await publicResume(store, 'Sales', 'sales');
  assert.equal(store.visibleResumeSnapshot(publicId).header.title, 'Sales title');
  store.updateResume(publicId, { isPublic: false });
  assert.equal(store.visibleResumeSnapshot(publicId), null);

  const { id: unpublished } = store.createResume({ name: 'Draft', slug: 'draft' });
  store.updateResume(unpublished, { isPublic: true });
  assert.equal(store.visibleResumeSnapshot(unpublished), null);
  assert.equal(store.visibleResumeSnapshot('missing'), null);
});
