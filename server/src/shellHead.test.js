import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { createResumeStore } from './resumeStore.js';
import { migrateToResumes } from './resumeMigration.js';
import { createShellHead } from './shellHead.js';
import { photoKey } from './shareImages.js';

// The HTML shell's head tags (issue #87) through the real store over
// ':memory:', with a fake card renderer: which page a path is, that only
// published, public content reaches them, and the share cards' lifecycle.

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQ';
const OTHER_PHOTO = 'data:image/png;base64,iVBORw0K';

async function makeStore({ renderShareCard, waitForCards = true } = {}) {
  const db = new Database(':memory:');
  ensureSchema(db);
  const defaultId = migrateToResumes(db);
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-shell-'));
  const cards = [];
  const store = createResumeStore({
    db,
    pdfDir,
    renderPdf: async () => Buffer.from('%PDF-fake'),
    renderShareCard:
      renderShareCard ??
      (async ({ content }) => {
        cards.push(content);
        return Buffer.from(`png:${content.name}`);
      }),
  });
  store.setHeader({ name: 'Jo Doe', title: 'Engineer', photoUrl: PHOTO, links: [{ url: 'https://github.com/jo' }, { url: 'mailto:jo@x.test' }] });
  store.createBlock({ type: 'summary', data: { text: 'Builds reliable things.' } });
  await store.publish();
  if (waitForCards) await store.refreshShareCards();
  const headFor = createShellHead(store);
  const head = (p, host = 'jo.example') => headFor({ path: p, protocol: 'https', host, hostname: host });
  return { db, store, defaultId, pdfDir, cards, head };
}

const tag = (html, attr, key) => html.match(new RegExp(`${attr}="${key}" content="([^"]*)"`))?.[1];
const jsonLd = (html) => {
  const raw = html.match(/ld\+json">(.*)<\/script>/)?.[1];
  return raw ? JSON.parse(raw) : null;
};

async function publicResume(store, slug, header = { name: 'Jo Doe', title: `${slug} title` }) {
  const { id } = store.createResume({ name: slug, slug });
  store.forResume(id).setHeader(header);
  await store.forResume(id).publish();
  store.updateResume(id, { isPublic: true });
  return id;
}

test('/ shows the default resume: its title, summary, card and Person', async () => {
  const { head, cards } = await makeStore();
  const { head: html, noindex } = head('/');
  assert.equal(noindex, false);
  assert.match(html, /<title>Jo Doe – Engineer<\/title>/);
  assert.equal(tag(html, 'name', 'description'), 'Builds reliable things.');
  assert.equal(tag(html, 'property', 'og:url'), 'https://jo.example/');
  assert.match(tag(html, 'property', 'og:image'), /^https:\/\/jo\.example\/api\/public\/images\/c[0-9a-f]{32}$/);
  assert.equal(tag(html, 'name', 'twitter:card'), 'summary_large_image');
  assert.equal(cards.length, 1);
  assert.deepEqual(jsonLd(html), {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Jo Doe',
    url: 'https://jo.example/',
    jobTitle: 'Engineer',
    image: `https://jo.example/api/public/images/${photoKey(PHOTO)}`,
    sameAs: ['https://github.com/jo'],
  });
  // A trailing slash is the same page; the editor and print pages keep
  // the generic tags.
  assert.ok(head('/resume/'));
  for (const p of ['/editor', '/print', '/print/card', '/template-preview', '/r', '/r/a/b']) assert.equal(head(p), null, p);
});

test('only the published snapshot reaches the tags, never the draft', async () => {
  const { store, head } = await makeStore();
  store.setHeader({ name: 'Draft Name', title: 'Draft' });
  store.setSite({ title: 'Draft title', description: 'Draft description' });
  const { head: html } = head('/');
  assert.doesNotMatch(html, /Draft/);
  await store.publish();
  const after = head('/').head;
  assert.match(after, /<title>Draft title<\/title>/);
  assert.equal(tag(after, 'name', 'description'), 'Draft description');
});

test('until its card is drawn a page names its photo, and the card is queued', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const { store, head } = await makeStore({ renderShareCard: async () => (await gate, Buffer.from('png')), waitForCards: false });
  let { head: html } = head('/');
  assert.equal(tag(html, 'property', 'og:image'), `https://jo.example/api/public/images/${photoKey(PHOTO)}`);
  assert.equal(tag(html, 'name', 'twitter:card'), 'summary');
  release();
  await store.refreshShareCards();
  ({ head: html } = head('/'));
  assert.equal(tag(html, 'name', 'twitter:card'), 'summary_large_image');
});

test('a failed card render falls back to the photo and is not retried at once', async () => {
  let attempts = 0;
  const quiet = console.error;
  console.error = () => {};
  let head;
  try {
    let store;
    ({ head, store } = await makeStore({
      renderShareCard: async () => {
        attempts += 1;
        throw new Error('no chromium');
      },
    }));
    head('/');
    head('/');
    await store.refreshShareCards();
  } finally {
    console.error = quiet;
  }
  assert.equal(attempts, 1);
  assert.equal(tag(head('/').head, 'name', 'twitter:card'), 'summary');
});

test('/r/<slug>: only a public, published resume, and without a Person', async () => {
  const { store, head } = await makeStore();
  assert.equal(head('/r/nope'), null);
  const { id } = store.createResume({ name: 'Private one', slug: 'private' });
  store.forResume(id).setHeader({ name: 'Secret Name', title: 'x' });
  assert.equal(head('/r/private'), null, 'private and unpublished');
  await store.forResume(id).publish();
  assert.equal(head('/r/private'), null, 'private');
  store.updateResume(id, { isPublic: true });
  const { head: html } = head('/r/Private');
  assert.match(html, /<title>Secret Name – x<\/title>/);
  assert.equal(tag(html, 'property', 'og:url'), 'https://jo.example/r/private');
  assert.equal(jsonLd(html), null);
  assert.equal(head('/r/%E0%A4%A'), null, 'a malformed escape is just not found');
});

test('the landing page: its seo, its noindex, and /resume behind it', async () => {
  const { store, head } = await makeStore();
  store.setLanding({ headline: 'Hi, I am Jo', subheadline: 'Engineer in Lisbon', seo: { title: '', description: '', noindex: true } });
  store.publishLanding();
  assert.match(head('/').head, /<title>Jo Doe – Engineer<\/title>/, 'not shown until enabled');
  store.setLandingEnabled(true);
  await store.refreshShareCards();
  const { head: html, noindex } = head('/');
  assert.equal(noindex, true);
  assert.match(html, /<title>Hi, I am Jo<\/title>/);
  assert.equal(tag(html, 'name', 'description'), 'Engineer in Lisbon');
  assert.equal(tag(html, 'property', 'og:type'), 'website');
  assert.equal(tag(html, 'name', 'twitter:card'), 'summary_large_image');
  assert.equal(jsonLd(html).name, 'Jo Doe');
  // /resume is the default resume now, at its own canonical URL; with the
  // landing page off it redirects to /, which is then its canonical URL.
  assert.equal(tag(head('/resume').head, 'property', 'og:url'), 'https://jo.example/resume');
  assert.equal(head('/resume').noindex, false);
  store.setLandingEnabled(false);
  assert.equal(tag(head('/resume').head, 'property', 'og:url'), 'https://jo.example/');
});

test("a resume's own domain shows that resume at /, landing page or not", async () => {
  const { store, head } = await makeStore();
  const id = await publicResume(store, 'sales', { name: 'Jo Sales', title: 'Seller' });
  store.updateResume(id, { hostnames: ['sales.example'] });
  store.publishLanding();
  store.setLandingEnabled(true);
  assert.match(head('/', 'sales.example').head, /<title>Jo Sales – Seller<\/title>/);
  assert.equal(tag(head('/', 'sales.example').head, 'property', 'og:url'), 'https://sales.example/');
});

test('an image is served only while a public page shows it', async () => {
  const { store, head, pdfDir } = await makeStore();
  const id = await publicResume(store, 'other', { name: 'Jo Other', title: 'x', photoUrl: OTHER_PHOTO });
  await store.refreshShareCards();
  const photo = store.shareImage(photoKey(OTHER_PHOTO));
  assert.equal(photo.contentType, 'image/png');
  assert.ok(photo.body.length > 0);
  const cardUrl = tag(head('/r/other').head, 'property', 'og:image');
  const cardKeyOf = (url) => url.split('/').pop();
  const card = store.shareImage(cardKeyOf(cardUrl));
  assert.equal(fs.readFileSync(card.path, 'utf8'), 'png:Jo Other');

  store.updateResume(id, { isPublic: false });
  assert.equal(store.shareImage(photoKey(OTHER_PHOTO)), null);
  assert.equal(store.shareImage(cardKeyOf(cardUrl)), null);
  assert.equal(store.shareImage('../cards'), null);

  // A new title is a new card; the one no page shows any more is deleted.
  store.setHeader({ name: 'Jo Doe', title: 'Staff Engineer', photoUrl: PHOTO });
  const before = fs.readdirSync(path.join(pdfDir, 'cards'));
  await store.publish();
  await store.refreshShareCards();
  const after = fs.readdirSync(path.join(pdfDir, 'cards'));
  assert.equal(after.length, 1);
  assert.notDeepEqual(after, before);
  assert.equal(after[0], `${cardKeyOf(tag(head('/').head, 'property', 'og:image'))}.png`);
});
