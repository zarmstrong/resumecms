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
  assert.deepEqual(cardsOf(draft), [{ resumeId: defaultId, label: '', blurb: '', showPdf: false }]);
  assert.deepEqual(store.getLandingStatus(), { enabled: false, publishedAt: null, isDirty: false, hasDraft: false });
});

test('hasDraft turns true with the first save and stays so (the editor offers presets until then)', async () => {
  const { store } = await makeStore();
  assert.equal(store.getLandingStatus().hasDraft, false);
  store.getLanding(); // reading the built draft doesn't store it
  assert.equal(store.getLandingStatus().hasDraft, false);
  store.setLanding(store.getLanding());
  assert.equal(store.getLandingStatus().hasDraft, true);
  assert.equal(store.publishLanding().hasDraft, true);
  store.discardLandingDraft();
  assert.equal(store.getLandingStatus().hasDraft, true);
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

test("hero actions and cards link a resume's PDF only while a visitor may open it", async () => {
  const { store, defaultId } = await makeStore();
  const salesId = await publicResume(store, 'Sales', 'sales');
  store.setLanding({
    actions: [
      { type: 'resume', label: 'PDF', resumeId: defaultId, open: 'pdf' },
      { type: 'resume', label: 'Sales PDF', resumeId: salesId, open: 'pdf' },
      { type: 'resume', label: 'Sales', resumeId: salesId },
    ],
    sections: [{ id: 'cards', kind: 'resumes', cards: [{ resumeId: defaultId, showPdf: true }, { resumeId: salesId, showPdf: true }] }],
  });
  store.setLandingEnabled(true);
  store.publishLanding();

  // Both have a rendered PDF; the default's is the host's own, the other's
  // goes by its slug, and each carries the file's version.
  let page = store.landingForHost('example.com');
  const defaultPdf = `/api/public/resume.pdf?v=${encodeURIComponent(store.getPublishStatus().pdfVersion)}`;
  const salesPdf = `/api/public/resumes/sales/resume.pdf?v=${encodeURIComponent(store.forResume(salesId).getPublishStatus().pdfVersion)}`;
  assert.deepEqual(page.actions, [
    { label: 'PDF', href: defaultPdf },
    { label: 'Sales PDF', href: salesPdf },
    { label: 'Sales', href: '/r/sales' },
  ]);
  assert.deepEqual(cardsOf(page).map((c) => c.pdfHref), [defaultPdf, salesPdf]);
  assert.equal(JSON.stringify(page).includes(salesId), false);
  // The editor's preview gets the same links.
  assert.deepEqual(store.getLandingContext().resumes.map((r) => r.pdfHref).sort(), [defaultPdf, salesPdf].sort());

  // No PDF on disk: the PDF button and link go, the page link stays.
  fs.rmSync(store.forResume(salesId).getPdfFile().path);
  page = store.landingForHost('example.com');
  assert.deepEqual(page.actions.map((a) => a.label), ['PDF', 'Sales']);
  assert.equal('pdfHref' in cardsOf(page)[1], false);

  // Private, then deleted: every action for it goes, and the draft still saves.
  store.updateResume(salesId, { isPublic: false });
  assert.deepEqual(store.landingForHost('example.com').actions.map((a) => a.label), ['PDF']);
  store.updateResume(salesId, { isPublic: true });
  store.deleteResume(salesId);
  assert.deepEqual(store.landingForHost('example.com').actions.map((a) => a.label), ['PDF']);
  const draft = store.getLanding();
  assert.deepEqual(store.setLanding({ ...draft, sections: [] }).actions.length, 3);
  assert.equal(status(() => store.setLanding({ ...draft, actions: [{ type: 'resume', resumeId: 'nope' }] })), 400);
});

test("an experience section shows a resume's latest published roles, only while a visitor may open it", async () => {
  const { store, defaultId } = await makeStore();
  const salesId = await publicResume(store, 'Sales', 'sales');
  const sales = store.forResume(salesId);
  const role = (jobTitle, extra = {}) => sales.createBlock({ type: 'experience', data: { jobTitle, company: 'Acme', startDate: '2020', endDate: '2022', description: 'Secret', ...extra } });
  role('First');
  const printOnly = role('Print only');
  sales.updateBlock(printOnly.id, { visibleWeb: false });
  role('Second', { companyUrl: 'javascript:alert(1)' });
  role('Third');
  await sales.publish();
  // A draft edit after the publish isn't shown.
  role('Unpublished');

  store.setLanding({ sections: [{ id: 'x', kind: 'experience', title: 'Recent work', resumeId: salesId, count: 2 }] });
  store.setLandingEnabled(true);
  store.publishLanding();
  let page = store.landingForHost('example.com');
  assert.deepEqual(page.sections, [
    {
      kind: 'experience',
      title: 'Recent work',
      href: '/r/sales',
      roles: [
        { jobTitle: 'First', company: 'Acme', companyUrl: '', location: '', dates: '2020 – 2022' },
        { jobTitle: 'Second', company: 'Acme', companyUrl: '', location: '', dates: '2020 – 2022' },
      ],
    },
  ]);
  const body = JSON.stringify(page);
  for (const leak of [salesId, 'Secret', 'Print only', 'Unpublished', 'javascript']) assert.equal(body.includes(leak), false, leak);
  // The editor's preview gets the same roles, already filtered.
  const target = store.getLandingContext().resumes.find((r) => r.id === salesId);
  assert.deepEqual(target.experience.map((r) => r.jobTitle), ['First', 'Second', 'Third']);
  assert.equal(JSON.stringify(target).includes('Secret'), false);
  // The default resume has no roles: a section for it shows nothing.
  assert.deepEqual(store.getLandingContext().resumes.find((r) => r.id === defaultId).experience, []);

  // Private, then unpublished, then deleted: the section goes at once.
  store.updateResume(salesId, { isPublic: false });
  assert.deepEqual(store.landingForHost('example.com').sections, []);
  store.updateResume(salesId, { isPublic: true });
  assert.equal(store.landingForHost('example.com').sections.length, 1);
  const unpublishedId = store.createResume({ name: 'Draft only', slug: 'draft-only' }).id;
  store.forResume(unpublishedId).createBlock({ type: 'experience', data: { jobTitle: 'Draft role' } });
  store.updateResume(unpublishedId, { isPublic: true });
  store.setLanding({ sections: [{ id: 'y', kind: 'experience', resumeId: unpublishedId }] });
  store.publishLanding();
  assert.deepEqual(store.landingForHost('example.com').sections, []);
  store.setLanding({ sections: [{ id: 'x', kind: 'experience', resumeId: salesId }] });
  store.publishLanding();
  store.deleteResume(salesId);
  assert.deepEqual(store.landingForHost('example.com').sections, []);
  // The draft still saves with it, but a new one for an unknown id doesn't.
  assert.equal(store.setLanding(store.getLanding()).sections[0].resumeId, salesId);
  assert.equal(status(() => store.setLanding({ sections: [{ kind: 'experience', resumeId: 'nope' }] })), 400);
});

test("education and skills sections show a resume's published entries and skill groups, only while a visitor may open it", async () => {
  const { store, defaultId } = await makeStore();
  const nurseId = await publicResume(store, 'Nurse', 'nurse');
  const nurse = store.forResume(nurseId);
  const school = (degree, extra = {}) => nurse.createBlock({ type: 'education', data: { degree, institution: 'State U', startDate: '2010', endDate: '2014', ...extra } });
  school('BSc Nursing');
  const printOnly = school('Print only');
  nurse.updateBlock(printOnly.id, { visibleWeb: false });
  school('Diploma', { location: 'Ohio' });
  school('Certificate');
  nurse.createBlock({ type: 'skills_group', data: { category: 'Languages', items: 'Spanish (fluent), ASL (conversational)' } });
  const secret = nurse.createBlock({ type: 'skills_group', data: { category: 'Secret skills', items: 'Lockpicking' } });
  nurse.updateBlock(secret.id, { visibleWeb: false });
  nurse.createBlock({ type: 'skills_group', data: { category: 'Clinical', items: 'Triage, IV therapy' } });
  await nurse.publish();
  // A draft edit after the publish isn't shown.
  school('Unpublished');
  nurse.createBlock({ type: 'skills_group', data: { category: 'Later', items: 'Unpublished skill' } });

  store.setLanding({
    sections: [
      { id: 'e', kind: 'education', title: 'Education', resumeId: nurseId, count: 2 },
      { id: 's', kind: 'skills', title: 'Skills', resumeId: nurseId, column: 'side' },
    ],
  });
  store.setLandingEnabled(true);
  store.publishLanding();
  const page = store.landingForHost('example.com');
  assert.deepEqual(page.sections, [
    {
      kind: 'education',
      title: 'Education',
      href: '/r/nurse',
      entries: [
        { degree: 'BSc Nursing', institution: 'State U', location: '', dates: '2010 – 2014' },
        { degree: 'Diploma', institution: 'State U', location: 'Ohio', dates: '2010 – 2014' },
      ],
    },
    {
      kind: 'skills',
      title: 'Skills',
      column: 'side',
      href: '/r/nurse',
      groups: [
        { category: 'Languages', items: ['Spanish (fluent)', 'ASL (conversational)'] },
        { category: 'Clinical', items: ['Triage', 'IV therapy'] },
      ],
    },
  ]);
  const body = JSON.stringify(page);
  for (const leak of [nurseId, printOnly.id, secret.id, 'Print only', 'Secret', 'Lockpicking', 'Unpublished']) assert.equal(body.includes(leak), false, leak);
  // The editor's preview gets the same lists, already filtered.
  const target = store.getLandingContext().resumes.find((r) => r.id === nurseId);
  assert.deepEqual(target.education.map((e) => e.degree), ['BSc Nursing', 'Diploma', 'Certificate']);
  assert.deepEqual(target.skills.map((g) => g.category), ['Languages', 'Clinical']);
  assert.equal(JSON.stringify(target).includes('Lockpicking'), false);
  assert.deepEqual(store.getLandingContext().resumes.find((r) => r.id === defaultId).skills, []);

  // Private, then unpublished, then deleted: the sections go at once.
  store.updateResume(nurseId, { isPublic: false });
  assert.deepEqual(store.landingForHost('example.com').sections, []);
  store.updateResume(nurseId, { isPublic: true });
  assert.equal(store.landingForHost('example.com').sections.length, 2);
  const unpublishedId = store.createResume({ name: 'Draft only', slug: 'draft-only' }).id;
  store.forResume(unpublishedId).createBlock({ type: 'education', data: { degree: 'Draft degree' } });
  store.forResume(unpublishedId).createBlock({ type: 'skills_group', data: { category: 'Draft', items: 'Draft skill' } });
  store.updateResume(unpublishedId, { isPublic: true });
  store.setLanding({ sections: [{ id: 'e', kind: 'education', resumeId: unpublishedId }, { id: 's', kind: 'skills', resumeId: unpublishedId }] });
  store.publishLanding();
  assert.deepEqual(store.landingForHost('example.com').sections, []);
  store.setLanding({ sections: [{ id: 'e', kind: 'education', resumeId: nurseId }, { id: 's', kind: 'skills', resumeId: nurseId }] });
  store.publishLanding();
  store.deleteResume(nurseId);
  assert.deepEqual(store.landingForHost('example.com').sections, []);
  // The draft still saves with them, but a new one for an unknown id doesn't.
  assert.deepEqual(store.setLanding(store.getLanding()).sections.map((s) => s.resumeId), [nurseId, nurseId]);
  assert.equal(status(() => store.setLanding({ sections: [{ kind: 'education', resumeId: 'nope' }] })), 400);
  assert.equal(status(() => store.setLanding({ sections: [{ kind: 'skills', resumeId: 'nope' }] })), 400);
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

test("its own colors and fonts can be applied to the default resume's site settings draft, merged, and nothing published", async () => {
  const { store, defaultId } = await makeStore();
  store.setSite({ title: 'Jo', layout: 'sidebar', fontSize: 'large', colors: { accent: '#123456', datesPill: '#2c5f7c' } });
  await store.publish();
  const published = store.getPublishedResume('web');
  assert.equal(store.getPublishStatus().isDirty, false);

  // Nothing to give while the page uses the resume's own.
  assert.equal(status(() => store.applyLandingStyleToResume()), 400);
  assert.equal(store.getPublishStatus().isDirty, false);

  store.setLanding({
    ...store.getLanding(),
    style: { source: 'custom', colors: { accent: '#aa0000', background: '#fafafa' }, font: 'inter', nameFont: '', darkColors: { background: '#000000' } },
  });
  store.setLandingEnabled(true);
  store.publishLanding();
  const landingStatus = store.getLandingStatus();

  const result = store.applyLandingStyleToResume();
  assert.equal(result.resumeId, defaultId);
  // Every other site setting and color stays; empty colors arrive as the
  // defaults the page is drawn in; no dark palette.
  assert.deepEqual(result.site, {
    title: 'Jo',
    layout: 'sidebar',
    fontSize: 'large',
    font: 'inter',
    nameFont: '',
    colors: { accent: '#aa0000', heading: '#14181c', text: '#14181c', background: '#fafafa', datesPill: '#2c5f7c' },
  });
  assert.deepEqual(store.getSite(), result.site);
  // A draft edit of the resume, published on its own.
  assert.equal(store.getPublishStatus().isDirty, true);
  assert.deepEqual(store.getPublishedResume('web').site, published.site);
  assert.deepEqual(store.getLandingStatus(), landingStatus);
  // The landing page keeps drawing itself in its own colors.
  assert.equal(store.landingForHost('example.com').site.colors.background, '#fafafa');

  // It follows the default when that moves, and never another resume.
  const other = await publicResume(store, 'Other', 'other');
  store.updateResume(other, { isDefault: true });
  const before = store.forResume(defaultId).getSite();
  assert.equal(store.applyLandingStyleToResume().resumeId, other);
  assert.equal(store.forResume(other).getSite().font, 'inter');
  assert.deepEqual(store.forResume(defaultId).getSite(), before);
});

test("the page's template and style are checked on save and resolve publicly", async () => {
  const { store } = await makeStore();
  assert.equal(status(() => store.setLanding({ style: { source: 'custom', colors: { accent: 'tomato' } } })), 400);
  assert.equal(status(() => store.setLanding({ template: '../x' })), 400);
  assert.equal(status(() => store.setLanding({ headline: 'Hi', style: { colors: { accent: 'tomato' } } }, { merge: true })), 400);
  store.setLanding({ headline: 'Hi', template: 'split', style: { source: 'custom', colors: { accent: '#aa0000' } } }, { merge: true });
  store.setLandingEnabled(true);
  store.publishLanding();
  const page = store.landingForHost('example.com');
  assert.equal(page.template, 'split');
  assert.equal(page.site.colors.accent, '#aa0000');
  assert.equal(page.darkColors, null);
});
