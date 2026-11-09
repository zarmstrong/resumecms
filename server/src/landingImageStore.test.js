import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { ensureSchema } from './schema.js';
import { createResumeStore } from './resumeStore.js';
import { migrateToResumes } from './resumeMigration.js';
import { createShellHead } from './shellHead.js';
import { IMAGE_GRACE_MS, LANDING_IMAGE_LIMITS } from './landingImageFields.js';

// The landing page's image store (issue #92) through the real store over
// ':memory:': uploads, what the editor and the public may fetch, the
// clean-up, the caps, and the share image in the HTML shell.

async function makeStore() {
  const db = new Database(':memory:');
  ensureSchema(db);
  migrateToResumes(db);
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-images-'));
  const store = createResumeStore({ db, pdfDir, renderPdf: async () => Buffer.from('%PDF-fake') });
  store.setHeader({ name: 'Jo', title: 'Engineer' });
  await store.publish();
  return { db, store };
}

const png = (color, width = 40, height = 20) => sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();

const status = async (fn) => {
  try {
    await fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

// Makes every stored image older than the grace period.
const age = (db) => db.prepare('UPDATE landing_images SET created_at = ?').run(new Date(Date.now() - IMAGE_GRACE_MS - 60_000).toISOString());

test('an upload is stored once, re-encoded, and the editor sees it at its own path', async () => {
  const { db, store } = await makeStore();
  const image = await store.uploadLandingImage(await png('#336699'));
  assert.match(image.id, /^[0-9a-f]{64}$/);
  assert.deepEqual([image.mime, image.width, image.height, image.src], ['image/png', 40, 20, `/api/landing/images/${image.id}`]);
  assert.equal((await store.uploadLandingImage(await png('#336699'))).id, image.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM landing_images').get().n, 1);

  const file = store.landingImage(image.id);
  assert.equal(file.mime, 'image/png');
  assert.equal((await sharp(file.bytes).metadata()).width, 40);
  assert.equal(store.landingImage('f'.repeat(64)), null);
  assert.equal(store.landingImage('../../etc/passwd'), null);
  assert.deepEqual(store.getLandingContext().images, [{ id: image.id, src: image.src, width: 40, height: 20 }]);
  assert.equal(await status(() => store.uploadLandingImage(Buffer.from('<svg/> pretending to be a png'))), 400);
});

test('the public gets an image only while the shown, published page shows it', async () => {
  const { store } = await makeStore();
  const a = await store.uploadLandingImage(await png('#aa0000'));
  const b = await store.uploadLandingImage(await png('#00aa00'));
  store.setLandingEnabled(true);
  store.setLanding({ headline: 'Jo', sections: [{ id: 'pic', kind: 'image', image: { imageId: a.id, alt: 'Red' } }] });
  // Uploaded and in the draft, but never published.
  assert.equal(store.publicLandingImage(a.id), null);

  store.publishLanding();
  const served = store.publicLandingImage(a.id);
  assert.equal(served.mime, 'image/png');
  assert.equal(served.noindex, false);
  assert.equal(store.publicLandingImage(b.id), null); // stored, but on no page
  const page = store.landingForHost('example.com');
  assert.deepEqual(page.sections[0].image, { src: `/api/public/landing/images/${a.id}`, alt: 'Red', width: 40, height: 20 });

  // Swapped in the draft: the published one still shows until the next publish.
  store.setLanding({ headline: 'Jo', photo: 'upload', photoImage: { imageId: b.id, alt: 'Green' }, seo: { noindex: true } });
  assert.ok(store.publicLandingImage(a.id));
  assert.equal(store.publicLandingImage(b.id), null);
  store.publishLanding();
  assert.equal(store.publicLandingImage(a.id), null);
  assert.equal(store.publicLandingImage(b.id).noindex, true);
  assert.equal(store.landingForHost('example.com').photoUrl, `/api/public/landing/images/${b.id}`);

  // Switched off: nothing is shown, so nothing is served.
  store.setLandingEnabled(false);
  assert.equal(store.publicLandingImage(b.id), null);
  assert.equal(store.publicLandingImage('nope'), null);
});

test('clean-up keeps what the draft or the snapshot references, and anything recent', async () => {
  const { db, store } = await makeStore();
  const inDraft = await store.uploadLandingImage(await png('#111111'));
  const published = await store.uploadLandingImage(await png('#222222'));
  const unused = await store.uploadLandingImage(await png('#333333'));
  const ids = () => db.prepare('SELECT id FROM landing_images').all().map((row) => row.id).sort();

  store.setLanding({ sections: [{ id: 'pic', kind: 'image', image: { imageId: published.id, alt: '' } }] });
  store.publishLanding();
  store.setLanding({ sections: [{ id: 'i', kind: 'items', items: [{ title: 'P', image: { imageId: inDraft.id, alt: '' } }] }] });
  // Nothing is old enough yet: an upload just before a discard survives it.
  assert.equal(store.pruneLandingImages(), 0);

  age(db);
  assert.equal(store.pruneLandingImages(), 1);
  assert.deepEqual(ids(), [inDraft.id, published.id].sort());
  assert.equal(store.landingImage(unused.id), null);

  // Discarding brings the published one back to the draft; the draft-only
  // one is then referenced by nothing and goes at the next publish.
  store.discardLandingDraft();
  store.publishLanding();
  assert.deepEqual(ids(), [published.id]);

  // A reference whose image went keeps the draft savable, and shows nothing.
  db.prepare('DELETE FROM landing_images').run();
  const draft = store.getLanding();
  assert.deepEqual(store.setLanding(draft), draft);
  store.setLandingEnabled(true);
  store.publishLanding();
  assert.deepEqual(store.landingForHost('example.com').sections, []);
  // But a new reference must name a stored image.
  assert.equal(
    await status(() => store.setLanding({ ...draft, seo: { image: { imageId: unused.id, alt: '' } } })),
    400
  );
});

test('the caps: a full store first drops what nothing uses, then refuses', async () => {
  const { db, store } = await makeStore();
  const insert = db.prepare('INSERT INTO landing_images (id, mime, width, height, bytes, created_at) VALUES (?, ?, 1, 1, ?, ?)');
  const now = new Date().toISOString();
  for (let i = 0; i < LANDING_IMAGE_LIMITS.count; i += 1) insert.run(i.toString(16).padStart(64, '0'), 'image/png', Buffer.alloc(1), now);
  const extra = await png('#444444');
  assert.equal(await status(() => store.uploadLandingImage(extra)), 409);
  const existing = db.prepare('SELECT id FROM landing_images LIMIT 1').get().id;
  store.setLanding({ sections: [{ id: 'pic', kind: 'image', image: { imageId: existing, alt: '' } }] });

  age(db);
  const image = await store.uploadLandingImage(extra);
  // Everything old and unreferenced went to make room; the referenced one stayed.
  assert.deepEqual(
    db.prepare('SELECT id FROM landing_images ORDER BY id').all().map((row) => row.id),
    [existing, image.id].sort()
  );

  // The total size counts too.
  db.prepare('DELETE FROM landing_images').run();
  insert.run('f'.repeat(64), 'image/png', Buffer.alloc(LANDING_IMAGE_LIMITS.totalBytes - 10), now);
  assert.equal(await status(async () => store.uploadLandingImage(await png('#555555'))), 409);
});

test("the shell names the landing page's share image, else its uploaded photo, and draws no card for it", async () => {
  const { store } = await makeStore();
  const share = await store.uploadLandingImage(await png('#123456', 1200, 630));
  const photo = await store.uploadLandingImage(await png('#654321', 100, 100));
  store.setLandingEnabled(true);
  store.setLanding({ headline: 'Jo', photo: 'upload', photoImage: { imageId: photo.id, alt: 'Jo' }, seo: { image: { imageId: share.id, alt: 'Jo speaking' } } });
  store.publishLanding();
  const headFor = createShellHead(store);
  const head = () => headFor({ path: '/', protocol: 'https', host: 'jo.example', hostname: 'jo.example' }).head;
  const tag = (html, attr, key) => html.match(new RegExp(`${attr}="${key}" content="([^"]*)"`))?.[1];

  let html = head();
  assert.equal(tag(html, 'property', 'og:image'), `https://jo.example/api/public/landing/images/${share.id}`);
  assert.equal(tag(html, 'property', 'og:image:alt'), 'Jo speaking');
  assert.equal(tag(html, 'property', 'og:image:width'), '1200');
  assert.equal(tag(html, 'property', 'og:image:height'), '630');
  assert.equal(tag(html, 'name', 'twitter:card'), 'summary_large_image');
  assert.equal(JSON.parse(html.match(/ld\+json">(.*)<\/script>/)[1]).image, `https://jo.example/api/public/landing/images/${photo.id}`);
  assert.ok(store.publicLandingImage(share.id));

  // Without one, the uploaded photo stands in (no card renderer here).
  store.setLanding({ ...store.getLanding(), seo: { title: '', description: '', noindex: false } });
  store.publishLanding();
  html = head();
  assert.equal(tag(html, 'property', 'og:image'), `https://jo.example/api/public/landing/images/${photo.id}`);
  assert.equal(tag(html, 'name', 'twitter:card'), 'summary');
  assert.equal(store.publicLandingImage(share.id), null);
});
