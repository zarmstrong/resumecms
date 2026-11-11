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
import { landingContactHandler } from './landingContact.js';

// The landing page's "Save contact" vCard (issue #124) over the real store
// on ':memory:', served on a real socket so the headers are express's own.

const db = new Database(':memory:');
ensureSchema(db);
migrateToResumes(db);
const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-contact-'));
const store = createResumeStore({ db, pdfDir, renderPdf: async () => Buffer.from('%PDF-fake') });

const app = express();
app.get('/contact.vcf', landingContactHandler(store));
const server = app.listen(0);
after(() => {
  server.close();
  fs.rmSync(pdfDir, { recursive: true, force: true });
});

// fetch() won't send a Host header of our choosing, so plain http.
function get({ host = 'example.com' } = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ port: server.address().port, path: '/contact.vcf', headers: { host } }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on('error', reject);
  });
}

const contact = (fields = {}) => ({
  id: 'contact',
  kind: 'contact',
  title: 'Get in touch',
  email: 'jo@example.com',
  phone: '+1 512 555 0100',
  area: 'Central Texas',
  address: '',
  hours: [],
  vcard: true,
  ...fields,
});
const setSections = (sections) => store.setLanding({ ...store.getLanding(), sections });
const unfolded = (body) => body.replace(/\r\n /g, '').split('\r\n');

function assertHeaders(res) {
  assert.equal(res.headers['cache-control'], 'no-cache');
  assert.match(res.headers.vary, /\bHost\b/);
  assert.match(res.headers.vary, /\bX-Forwarded-Host\b/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
}

test('setup: a published default resume with a domain-mapped second one', async () => {
  store.setHeader({ name: 'Jo Doe', title: 'Master plumber' });
  await store.publish();
  const { id } = store.createResume({ name: 'Sales', slug: 'sales' });
  store.forResume(id).setHeader({ name: 'Jo Doe', title: 'Sales' });
  await store.forResume(id).publish();
  store.updateResume(id, { isPublic: true, hostnames: ['sales.example.com'] });
});

test('a 404 until the landing page is both published and switched on', async () => {
  setSections([contact()]);
  const never = await get();
  assert.equal(never.status, 404, 'never published');
  assertHeaders(never);
  store.setLandingEnabled(true);
  assert.equal((await get()).status, 404, 'enabled, never published');
  store.publishLanding();
  store.setLandingEnabled(false);
  assert.equal((await get()).status, 404, 'published, switched off');
  store.setLandingEnabled(true);
  assert.equal((await get()).status, 200);
});

test('the vCard of the published contact section, as an attachment', async () => {
  const res = await get();
  assert.equal(res.status, 200);
  assertHeaders(res);
  assert.equal(res.headers['content-type'], 'text/vcard; charset=utf-8');
  assert.equal(res.headers['content-disposition'], 'attachment; filename="Jo-Doe.vcf"');
  assert.equal(res.headers['x-robots-tag'], 'noindex');
  // The name and title the page's Person gets (the default resume's
  // published header), and the page's own URL.
  assert.deepEqual(unfolded(res.body), [
    'BEGIN:VCARD',
    'VERSION:3.0',
    'N:Doe;Jo;;;',
    'FN:Jo Doe',
    'TITLE:Master plumber',
    'EMAIL;TYPE=INTERNET,WORK:jo@example.com',
    'TEL;TYPE=WORK,VOICE:+1 512 555 0100',
    'NOTE:Service area: Central Texas',
    'URL:http://example.com/',
    'END:VCARD',
    '',
  ]);
});

test("never on a resume's own domain, where `/` shows that resume", async () => {
  const res = await get({ host: 'sales.example.com' });
  assert.equal(res.status, 404);
  assertHeaders(res);
});

test('it never reads the draft: what changed there waits for a publish', async () => {
  // Edited in the draft: the published card is still served.
  setSections([contact({ email: 'new@example.com', phone: '' })]);
  let body = (await get()).body;
  assert.ok(body.includes('jo@example.com'));
  assert.ok(!body.includes('new@example.com'));
  assert.ok(body.includes('TEL'));
  // Removed from the draft, or switched off there: still served until published.
  setSections([]);
  assert.equal((await get()).status, 200);
  setSections([contact({ vcard: false })]);
  assert.equal((await get()).status, 200);
  // A header change waits for the resume's publish too.
  store.setHeader({ name: 'Joanna Doe', title: 'Plumber' });
  assert.ok((await get()).body.includes('FN:Jo Doe'));

  // Published without one, and then added to the draft: a 404 until published.
  setSections([{ id: 't', kind: 'text', title: '', body: 'Hi' }]);
  store.publishLanding();
  assert.equal((await get()).status, 404, 'no contact section');
  setSections([contact()]);
  assert.equal((await get()).status, 404, 'only in the draft');
  store.publishLanding();
  assert.equal((await get()).status, 200);
  setSections([contact({ email: 'new@example.com' })]);
  store.publishLanding();
  assert.ok((await get()).body.includes('new@example.com'));
});

test('a 404 while the published section has its button off, is hidden, or shows nothing', async () => {
  for (const section of [contact({ vcard: false }), contact({ hidden: true }), contact({ email: 'jo@', phone: 'x', area: '' })]) {
    setSections([section]);
    store.publishLanding();
    const res = await get();
    assert.equal(res.status, 404, JSON.stringify(section));
    assertHeaders(res);
  }
  setSections([contact()]);
  store.publishLanding();
  assert.equal((await get()).status, 200);
});

test('only what the page shows: a half-typed email or a phone without digits stays out', async () => {
  setSections([contact({ email: 'jo@exam', phone: 'ask me', area: '', address: '1 Main St\nAustin', hours: [{ days: 'Mon–Fri', time: '8–5' }] })]);
  store.publishLanding();
  const lines = unfolded((await get()).body);
  assert.ok(!lines.some((line) => line.startsWith('EMAIL') || line.startsWith('TEL')));
  assert.ok(lines.includes('ADR;TYPE=WORK:;;1 Main St\\nAustin;;;;'));
  assert.ok(lines.includes('NOTE:Hours:\\nMon–Fri: 8–5'));
});
