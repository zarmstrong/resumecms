import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSchema } from '../schema.js';
import { createResumeStore } from '../resumeStore.js';
import { migrateToResumes } from '../resumeMigration.js';
import { RENDER_COOKIE, renderCookieValue } from '../renderAccess.js';
import { publicResumeHandlers } from './publicResume.js';

// The public resume endpoints over the real store on ':memory:', served on
// a real socket so the headers are express's own. Issue #89's "← Home" link.

const db = new Database(':memory:');
ensureSchema(db);
const defaultId = migrateToResumes(db);
const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-public-'));
const store = createResumeStore({ db, pdfDir, renderPdf: async () => Buffer.from('%PDF-fake') });

const { hostResume, slugResume } = publicResumeHandlers(store);
const app = express();
app.get('/resume', hostResume);
app.get('/resumes/:slug', slugResume);
const server = app.listen(0);
after(() => {
  server.close();
  fs.rmSync(pdfDir, { recursive: true, force: true });
});

// fetch() won't send a Host header of our choosing, so plain http.
function get(urlPath, { host = 'example.com', cookie } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { host, ...(cookie ? { cookie } : {}) };
    http
      .get({ port: server.address().port, path: urlPath, headers }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(body) }));
      })
      .on('error', reject);
  });
}

const HOME = { href: '/', label: 'Home' };
let salesId;

test('setup: a published default and a public resume with a domain of its own', async () => {
  store.setHeader({ name: 'Jo', title: 'Engineer' });
  await store.publish();
  ({ id: salesId } = store.createResume({ name: 'Sales', slug: 'sales' }));
  store.forResume(salesId).setHeader({ name: 'Jo', title: 'Sales engineer' });
  await store.forResume(salesId).publish();
  store.updateResume(salesId, { isPublic: true, hostnames: ['sales.example.com'] });
});

test('both endpoints vary on the host, which the home link depends on', async () => {
  for (const route of ['/resume', '/resumes/sales']) {
    const res = await get(route);
    assert.equal(res.status, 200, route);
    assert.match(res.headers.vary, /\bHost\b/, route);
    assert.match(res.headers.vary, /\bX-Forwarded-Host\b/, route);
  }
});

test('no home link until the landing page is both switched on and published', async () => {
  assert.equal((await get('/resume')).json.home, undefined);
  store.setLandingEnabled(true);
  assert.equal((await get('/resume')).json.home, undefined, 'enabled, never published');
  store.setLandingEnabled(false);
  store.publishLanding();
  assert.equal((await get('/resume')).json.home, undefined, 'published, switched off');
  store.setLandingEnabled(true);
  assert.deepEqual((await get('/resume')).json.home, HOME);
  assert.deepEqual((await get('/resume?mode=web')).json.home, HOME);
  assert.deepEqual((await get('/resumes/sales')).json.home, HOME);
});

test('never in print mode, nor for the PDF renderer', async () => {
  assert.equal((await get('/resume?mode=print')).json.home, undefined);
  assert.equal((await get('/resumes/sales?mode=print')).json.home, undefined);
  for (const id of [defaultId, salesId]) {
    const res = await get('/resume?mode=web', { cookie: `${RENDER_COOKIE}=${renderCookieValue(id)}` });
    assert.equal(res.headers['x-resumecms-resume'], id);
    assert.equal(res.json.home, undefined, id);
  }
});

test("never on a resume's own domain, where `/` shows that resume", async () => {
  const own = await get('/resume', { host: 'sales.example.com' });
  assert.equal(own.json.header.title, 'Sales engineer');
  assert.equal(own.json.home, undefined);
  assert.equal((await get('/resumes/sales', { host: 'sales.example.com' })).json.home, undefined);
  // A mapping counts even before its resume is published, as for `/`.
  const { id: draftId } = store.createResume({ name: 'Draft', slug: 'draft' });
  store.updateResume(draftId, { hostnames: ['draft.example.com'] });
  assert.equal((await get('/resume', { host: 'draft.example.com' })).json.home, undefined);
});

test('the setting is drafted: switching it off takes effect on publish', async () => {
  store.setLanding({ ...store.getLanding(), homeLink: false });
  assert.deepEqual((await get('/resume')).json.home, HOME);
  store.publishLanding();
  assert.equal((await get('/resume')).json.home, undefined);
  assert.equal((await get('/resumes/sales')).json.home, undefined);
});

test('a snapshot published before the setting existed has the link on', async () => {
  const stored = JSON.parse(db.prepare("SELECT value FROM settings WHERE key = 'landing_published'").get().value);
  delete stored.homeLink;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'landing_published'").run(JSON.stringify(stored));
  assert.deepEqual((await get('/resume')).json.home, HOME);
});

test('an unknown slug is still a 404, and still varies', async () => {
  const res = await get('/resumes/nope');
  assert.equal(res.status, 404);
  assert.match(res.headers.vary, /\bHost\b/);
});
