import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PDFDocument } from 'pdf-lib';
import { ensureSchema } from './schema.js';
import { createResumeStore } from './resumeStore.js';
import { migrateToResumes } from './resumeMigration.js';
import { IMAGE_GRACE_MS } from './landingImageFields.js';
import { LANDING_FILE_LIMITS, PUBLIC_FILE_PATH } from './landingFileFields.js';
import { landingFileHandlers } from './routes/landingFiles.js';

// The landing page's documents (issue #128) through the real store over
// ':memory:': uploads, what the editor and the public may fetch, the
// clean-up and the caps, and the routes on a real socket for the headers.

const pdfDirs = [];
after(() => pdfDirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

async function makeStore() {
  const db = new Database(':memory:');
  ensureSchema(db);
  migrateToResumes(db);
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-files-'));
  pdfDirs.push(pdfDir);
  const store = createResumeStore({ db, pdfDir, renderPdf: async () => Buffer.from('%PDF-fake') });
  store.setHeader({ name: 'Jo', title: 'Engineer' });
  await store.publish();
  return { db, store };
}

// A real PDF of `pages` pages, so each fixture is a different file.
async function pdf(pages = 1) {
  const doc = await PDFDocument.create();
  doc.setAuthor('Jo Secret');
  for (let i = 0; i < pages; i += 1) doc.addPage([100 + i, 100]);
  return Buffer.from(await doc.save());
}

const status = async (fn) => {
  try {
    await fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

// Makes every stored file older than the grace period.
const age = (db) => db.prepare('UPDATE landing_files SET created_at = ?').run(new Date(Date.now() - IMAGE_GRACE_MS - 60_000).toISOString());
const section = (documents, extra = {}) => ({ id: 'docs', kind: 'documents', title: 'Writing', documents, ...extra });
const entry = (file, label = '', description = '') => ({ file: file && { fileId: file.id, name: file.name }, label, description });

test('an upload is stripped, stored once under its hash, and the editor sees it at its own path', async () => {
  const { db, store } = await makeStore();
  const input = await pdf();
  const file = await store.uploadLandingFile(input, { name: 'C:\\Users\\jo\\Writing "sample".PDF' });
  assert.match(file.id, /^[0-9a-f]{64}$/);
  assert.equal(file.name, 'Writing sample.pdf');
  assert.equal(file.src, `/api/landing/files/${file.id}`);
  const bytes = store.landingFile(file.id);
  assert.equal(bytes.length, file.size);
  assert.equal((await PDFDocument.load(bytes, { updateMetadata: false })).getAuthor(), undefined);
  assert.equal((await store.uploadLandingFile(input, { name: 'again.pdf' })).id, file.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM landing_files').get().n, 1);
  assert.deepEqual(store.getLandingContext().files, [{ id: file.id, src: file.src, size: file.size }]);
  assert.equal(store.landingFile('f'.repeat(64)), null);
  assert.equal(store.landingFile('../../etc/passwd'), null);
  assert.equal(await status(() => store.uploadLandingFile(Buffer.from('<html>not a pdf</html>'), { name: 'x.pdf' })), 400);
});

test('a documents section resolves to label, description, public path and size, and drops what has no file', async () => {
  const { store } = await makeStore();
  const a = await store.uploadLandingFile(await pdf(1), { name: 'Teaching philosophy.pdf' });
  const b = await store.uploadLandingFile(await pdf(2), { name: 'sample.pdf' });
  store.setLandingEnabled(true);
  store.setLanding({ headline: 'Jo', sections: [section([entry(a), entry(b, 'Lesson plan', 'Year 9 science'), entry(null, 'Pending')])] });
  store.publishLanding();
  assert.deepEqual(store.landingForHost('example.com').sections, [
    {
      kind: 'documents',
      title: 'Writing',
      documents: [
        { label: 'Teaching philosophy', description: '', href: `${PUBLIC_FILE_PATH}${a.id}/Teaching%20philosophy.pdf`, size: a.size },
        { label: 'Lesson plan', description: 'Year 9 science', href: `${PUBLIC_FILE_PATH}${b.id}/sample.pdf`, size: b.size },
      ],
    },
  ]);

  // Nothing with a file left: the section is left out, heading and all.
  store.setLanding({ headline: 'Jo', sections: [section([entry(null, 'Pending')]), section([entry(a)], { id: 'h', hidden: true })] });
  store.publishLanding();
  assert.deepEqual(store.landingForHost('example.com').sections, []);
});

test('the public gets a file only while the shown, published page shows it, under the name it shows', async () => {
  const { store } = await makeStore();
  const a = await store.uploadLandingFile(await pdf(1), { name: 'cv.pdf' });
  const b = await store.uploadLandingFile(await pdf(2), { name: 'other.pdf' });
  store.setLandingEnabled(true);
  store.setLanding({ headline: 'Jo', sections: [section([entry(a)])] });
  // Uploaded and in the draft, but never published.
  assert.equal(store.publicLandingFile(a.id, 'cv.pdf'), null);

  store.publishLanding();
  assert.equal(store.publicLandingFile(a.id, 'cv.pdf').bytes.length, a.size);
  assert.equal(store.publicLandingFile(a.id, 'cv.pdf').noindex, false);
  assert.equal(store.publicLandingFile(a.id, 'renamed.pdf'), null);
  assert.equal(store.publicLandingFile(b.id, 'other.pdf'), null); // stored, on no page

  // Hidden in the draft: still shown until the next publish.
  store.setLanding({ headline: 'Jo', sections: [section([entry(a)], { hidden: true })], seo: { noindex: true } });
  assert.ok(store.publicLandingFile(a.id, 'cv.pdf'));
  store.publishLanding();
  assert.equal(store.publicLandingFile(a.id, 'cv.pdf'), null);

  store.setLanding({ headline: 'Jo', sections: [section([entry(b)])], seo: { noindex: true } });
  store.publishLanding();
  assert.equal(store.publicLandingFile(b.id, 'other.pdf').noindex, true);
  // Switched off: nothing is shown, so nothing is served.
  store.setLandingEnabled(false);
  assert.equal(store.publicLandingFile(b.id, 'other.pdf'), null);
  assert.equal(store.publicLandingFile('nope', 'other.pdf'), null);
});

test('references: a new one must name a stored file, one in the draft may outlive it', async () => {
  const { db, store } = await makeStore();
  const a = await store.uploadLandingFile(await pdf(1), { name: 'cv.pdf' });
  assert.equal(await status(() => store.setLanding({ sections: [section([{ file: { fileId: 'c'.repeat(64), name: 'x.pdf' } }])] })), 400);
  assert.equal(await status(() => store.setLanding({ sections: [section([{ file: { fileId: a.id, name: 'a/b.pdf' } }])] })), 400);
  assert.equal(await status(() => store.setLanding({ sections: [section([{ file: { fileId: a.id, name: 'x.pdf' }, extra: 1 }])] })), 400);
  store.setLanding({ sections: [section([entry(a)])] });
  db.prepare('DELETE FROM landing_files').run();
  const draft = store.getLanding();
  assert.deepEqual(store.setLanding(draft), draft);
  store.setLandingEnabled(true);
  store.publishLanding();
  assert.deepEqual(store.landingForHost('example.com').sections, []);
});

test('clean-up keeps what the draft or the snapshot references, and anything recent', async () => {
  const { db, store } = await makeStore();
  const inDraft = await store.uploadLandingFile(await pdf(1), { name: 'a.pdf' });
  const published = await store.uploadLandingFile(await pdf(2), { name: 'b.pdf' });
  const unused = await store.uploadLandingFile(await pdf(3), { name: 'c.pdf' });
  const ids = () => db.prepare('SELECT id FROM landing_files').all().map((row) => row.id).sort();

  store.setLanding({ sections: [section([entry(published)])] });
  store.publishLanding();
  store.setLanding({ sections: [section([entry(inDraft)])] });
  assert.equal(store.pruneLandingFiles(), 0);

  age(db);
  assert.equal(store.pruneLandingFiles(), 1);
  assert.deepEqual(ids(), [inDraft.id, published.id].sort());
  assert.equal(store.landingFile(unused.id), null);

  // Discarded, then published: the draft-only one goes with the publish.
  store.discardLandingDraft();
  store.publishLanding();
  assert.deepEqual(ids(), [published.id]);
});

test('the caps: a full store first drops what nothing uses, then refuses', async () => {
  const { db, store } = await makeStore();
  const insert = db.prepare('INSERT INTO landing_files (id, bytes, created_at) VALUES (?, ?, ?)');
  const now = new Date().toISOString();
  for (let i = 0; i < LANDING_FILE_LIMITS.count; i += 1) insert.run(i.toString(16).padStart(64, '0'), Buffer.from('%PDF-'), now);
  const extra = await pdf(4);
  assert.equal(await status(() => store.uploadLandingFile(extra, { name: 'x.pdf' })), 409);
  const existing = db.prepare('SELECT id FROM landing_files LIMIT 1').get().id;
  store.setLanding({ sections: [section([{ file: { fileId: existing, name: 'kept.pdf' }, label: '', description: '' }])] });

  age(db);
  const file = await store.uploadLandingFile(extra, { name: 'x.pdf' });
  assert.deepEqual(
    db.prepare('SELECT id FROM landing_files ORDER BY id').all().map((row) => row.id),
    [existing, file.id].sort()
  );

  // The total size counts too.
  db.prepare('DELETE FROM landing_files').run();
  insert.run('f'.repeat(64), Buffer.alloc(LANDING_FILE_LIMITS.totalBytes - 10), now);
  assert.equal(await status(async () => store.uploadLandingFile(await pdf(5), { name: 'y.pdf' })), 409);
});

// The routes, as routes/landing.js and routes/public.js mount them.
function serve(store) {
  const files = landingFileHandlers(store);
  const app = express();
  app.use(express.json());
  app.post('/api/landing/files', ...files.upload);
  app.get('/api/landing/files/:id', files.editorFile);
  app.get('/api/landing/files/:id/:name', files.editorFile);
  app.get('/api/public/landing/files/:id/:name', files.publicFile);
  const server = app.listen(0);
  const request = (method, urlPath, { body, type = 'application/pdf' } = {}) =>
    new Promise((resolve, reject) => {
      const req = http.request({ port: server.address().port, path: urlPath, method, headers: body ? { 'content-type': type } : {} }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end(body);
    });
  return { server, request };
}

test('the routes: upload by raw body, the public file with its headers, and 404s for what the page does not show', async () => {
  const { store } = await makeStore();
  const { server, request } = serve(store);
  try {
    // Any declared type but JSON; the bytes decide.
    const up = await request('POST', '/api/landing/files?name=My%20portfolio.pdf', { body: await pdf(), type: 'image/png' });
    assert.equal(up.status, 201);
    const file = JSON.parse(up.body);
    assert.equal(file.name, 'My portfolio.pdf');
    assert.equal((await request('POST', '/api/landing/files', { body: Buffer.from('GIF89a') })).status, 400);
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(LANDING_FILE_LIMITS.uploadBytes)]);
    assert.equal((await request('POST', '/api/landing/files', { body: big })).status, 413);

    const editor = await request('GET', `/api/landing/files/${file.id}`);
    assert.equal(editor.status, 200);
    assert.equal(editor.headers['cache-control'], 'private, max-age=31536000, immutable');
    assert.equal(editor.headers['content-type'], 'application/pdf');

    const publicPath = `/api/public/landing/files/${file.id}/My%20portfolio.pdf`;
    // In the draft only, then published while the page is off: not served.
    store.setLanding({ headline: 'Jo', sections: [section([entry(file)])] });
    let res = await request('GET', publicPath);
    assert.equal(res.status, 404);
    assert.equal(res.headers['cache-control'], 'no-cache');
    store.publishLanding();
    assert.equal((await request('GET', publicPath)).status, 404);

    store.setLandingEnabled(true);
    res = await request('GET', publicPath);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal(res.headers['content-disposition'], `inline; filename="My portfolio.pdf"; filename*=UTF-8''My%20portfolio.pdf`);
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['content-security-policy'], 'sandbox');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.equal(res.headers.etag, `"${file.id}"`);
    assert.equal(res.headers['x-robots-tag'], undefined);
    assert.equal(res.body.length, file.size);
    assert.equal(res.body.toString('latin1', 0, 5), '%PDF-');
    // Under another name, or a file the page doesn't show: not found.
    assert.equal((await request('GET', `/api/public/landing/files/${file.id}/other.pdf`)).status, 404);
    assert.equal((await request('GET', `/api/public/landing/files/${'0'.repeat(64)}/x.pdf`)).status, 404);
  } finally {
    server.close();
  }
});
