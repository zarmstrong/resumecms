import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { createResumeStore } from './resumeStore.js';
import { migrateToResumes } from './resumeMigration.js';

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
  assert.deepEqual(draft.resumes, [{ resumeId: defaultId, label: '', blurb: '' }]);
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
  store.setLanding({ headline: 'A', intro: 'B' });
  const merged = store.setLanding({ headline: 'C', intro: null }, { merge: true });
  assert.equal(merged.headline, 'C');
  assert.equal(merged.intro, '');
  // REST replaces: what isn't sent is reset.
  assert.equal(store.setLanding({ intro: 'only' }).headline, '');
  assert.equal(status(() => store.setLanding({ links: [{ label: 'x', url: 'javascript:alert(1)' }] })), 400);
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
    resumes: [{ resumeId: defaultId }, { resumeId: salesId, blurb: 'For sales' }, { resumeId: hiddenId, label: '' }],
  });
  store.setLandingEnabled(true);
  store.publishLanding();

  let page = store.landingForHost('example.com');
  assert.deepEqual(page.resumes, [
    { label: 'Engineer', blurb: '', href: '/resume' },
    { label: 'Sales title', blurb: 'For sales', href: '/r/sales' },
  ]);
  const body = JSON.stringify(page);
  assert.equal(body.includes(hiddenId), false);
  assert.equal(body.includes(salesId), false);
  assert.equal(body.includes('tailored for Jane'), false);

  store.updateResume(salesId, { slug: 'sales-2026' });
  assert.equal(store.landingForHost('example.com').resumes[1].href, '/r/sales-2026');

  store.updateResume(salesId, { isPublic: false });
  page = store.landingForHost('example.com');
  assert.deepEqual(page.resumes.map((c) => c.href), ['/resume']);

  store.updateResume(salesId, { isPublic: true });
  store.deleteResume(salesId);
  assert.deepEqual(store.landingForHost('example.com').resumes.map((c) => c.href), ['/resume']);
  // The draft still holds the deleted resume's card and can still be saved.
  const draft = store.getLanding();
  assert.equal(store.setLanding({ ...draft, headline: 'Still saves' }).resumes.length, 3);
  // But a new card for an unknown id can't be added.
  assert.equal(status(() => store.setLanding({ ...draft, resumes: [...draft.resumes, { resumeId: 'nope' }] })), 400);
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
