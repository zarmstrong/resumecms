import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import { ensureSchema } from '../schema.js';
import { createResumeStore } from '../resumeStore.js';
import { migrateToResumes } from '../resumeMigration.js';
import { NEUTRAL_COLORS } from '../favicon.js';
import { faviconRoutes } from './favicon.js';

// /favicon.svg and /apple-touch-icon.png (issue #104) over the real store
// on ':memory:', served on a real socket so the headers are express's own.

const db = new Database(':memory:');
ensureSchema(db);
migrateToResumes(db);
const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-favicon-'));
const store = createResumeStore({
  db,
  pdfDir,
  renderPdf: async () => Buffer.from('%PDF-fake'),
  renderShareCard: async () => Buffer.from('png'),
});

function serve(routes) {
  const app = express();
  app.use(routes);
  const server = app.listen(0);
  after(() => server.close());
  return server;
}
const server = serve(faviconRoutes(store));
after(() => fs.rmSync(pdfDir, { recursive: true, force: true }));

// fetch() won't send a Host header of our choosing, so plain http.
function get(urlPath, { host = 'jo.example', headers = {}, on = server } = {}) {
  return new Promise((resolve, reject) => {
    http
      .get({ port: on.address().port, path: urlPath, headers: { host, ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({ status: res.statusCode, headers: res.headers, body, text: body.toString('utf8') });
        });
      })
      .on('error', reject);
  });
}

const initials = (svg) => svg.match(/<text[^>]*>(.*)<\/text>/)?.[1] ?? null;
const tileColor = (svg) => svg.match(/<rect class="tile"[^>]*fill="(#[0-9a-f]{6})"/)?.[1];
const svgOf = async (host) => (await get('/favicon.svg', { host })).text;

let salesId;

test('nothing published yet: the neutral mark', async () => {
  store.setHeader({ name: 'Draft Name', title: 'x' });
  store.setSite({ colors: { accent: '#aa0000' } });
  const svg = await svgOf('jo.example');
  assert.equal(initials(svg), null);
  assert.equal(tileColor(svg), NEUTRAL_COLORS.accent);
});

test("the default resume's published name and accent, never its draft", async () => {
  store.setHeader({ name: 'Jo Doe', title: 'Engineer' });
  store.setSite({ colors: { accent: '#336699' } });
  await store.publish();
  let svg = await svgOf('jo.example');
  assert.equal(initials(svg), 'JD');
  assert.equal(tileColor(svg), '#336699');
  store.setHeader({ name: 'Someone Else', title: 'Engineer' });
  store.setSite({ colors: { accent: '#aa0000' } });
  svg = await svgOf('jo.example');
  assert.equal(initials(svg), 'JD', 'a draft edit changes nothing');
  assert.equal(tileColor(svg), '#336699');
  store.discardDraft();
});

test("a host mapped to a resume gets that resume's icon", async () => {
  ({ id: salesId } = store.createResume({ name: 'Sales', slug: 'sales' }));
  const sales = store.forResume(salesId);
  sales.setHeader({ name: 'Sam Sales', title: 'Seller' });
  sales.setSite({ colors: { accent: '#884400' } });
  store.updateResume(salesId, { hostnames: ['sales.example'] });
  // Mapped but never published: forHost() falls back to the default.
  assert.equal(initials(await svgOf('sales.example')), 'JD');
  await sales.publish();
  const svg = await svgOf('sales.example');
  assert.equal(initials(svg), 'SS');
  assert.equal(tileColor(svg), '#884400');
  assert.equal(initials(await svgOf('jo.example')), 'JD', 'other hosts keep the default');
});

test('the headers: type, nosniff, Vary, revalidate, a strong ETag and 304', async () => {
  for (const route of ['/favicon.svg', '/apple-touch-icon.png']) {
    const res = await get(route);
    assert.equal(res.status, 200, route);
    assert.equal(res.headers['cache-control'], 'no-cache', route);
    assert.match(res.headers.vary, /\bHost\b/, route);
    assert.match(res.headers.vary, /\bX-Forwarded-Host\b/, route);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', route);
    assert.match(res.headers.etag, /^"[0-9a-f]{32}"$/, `${route}: strong`);
    const again = await get(route, { headers: { 'if-none-match': res.headers.etag } });
    assert.equal(again.status, 304, route);
    assert.equal(again.body.length, 0, route);
    assert.equal(again.headers['cache-control'], 'no-cache', route);
    const other = await get(route, { host: 'sales.example', headers: { 'if-none-match': res.headers.etag } });
    assert.equal(other.status, 200, `${route}: another host's icon is another ETag`);
  }
  const svg = await get('/favicon.svg');
  assert.match(svg.headers['content-type'], /^image\/svg\+xml\b/);
  assert.match(svg.headers['content-security-policy'], /default-src 'none'/);
  assert.equal((await get('/apple-touch-icon.png')).headers['content-type'], 'image/png');
});

test('a rename or a recolor, once published, is a new ETag', async () => {
  const before = (await get('/favicon.svg')).headers.etag;
  const beforePng = (await get('/apple-touch-icon.png')).headers.etag;
  store.setHeader({ name: 'Jo Doe', title: 'Engineer' });
  store.setSite({ colors: { accent: '#225588' } });
  assert.equal((await get('/favicon.svg')).headers.etag, before, 'not yet published');
  await store.publish();
  const after = await get('/favicon.svg', { headers: { 'if-none-match': before } });
  assert.equal(after.status, 200);
  assert.notEqual(after.headers.etag, before);
  assert.equal(tileColor(after.text), '#225588');
  assert.notEqual((await get('/apple-touch-icon.png')).headers.etag, beforePng);
});

test('the PNG: 180×180, the light palette, per host', async () => {
  const pixel = async (host) => {
    const { body } = await get('/apple-touch-icon.png', { host });
    const meta = await sharp(body).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['png', 180, 180], host);
    const { data } = await sharp(body).extract({ left: 1, top: 1, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    return Buffer.from(data).toString('hex');
  };
  assert.equal(await pixel('jo.example'), '225588');
  assert.equal(await pixel('sales.example'), '884400');
});

test("the landing page: the default's published name, its own palette, and a dark one", async () => {
  store.setLanding({ headline: 'Hi, I am Jo', subheadline: 'Engineer' });
  store.publishLanding();
  store.setLandingEnabled(true);
  // The resume's colors while the page uses them.
  let svg = await svgOf('jo.example');
  assert.equal(initials(svg), 'JD');
  assert.equal(tileColor(svg), '#225588');
  assert.doesNotMatch(svg, /prefers-color-scheme/);

  store.setLanding({
    ...store.getLanding(),
    style: { source: 'custom', colors: { accent: '#aa3366' }, font: '', nameFont: '', darkColors: { accent: '#ffcc00' } },
  });
  assert.equal(tileColor(await svgOf('jo.example')), '#225588', 'the draft style is not shown');
  store.publishLanding();
  svg = await svgOf('jo.example');
  assert.equal(tileColor(svg), '#aa3366');
  assert.match(svg, /@media \(prefers-color-scheme: dark\)\{\.tile\{fill:#ffcc00\}/);
  // The PNG is the light one.
  const { body } = await get('/apple-touch-icon.png');
  const { data } = await sharp(body).extract({ left: 1, top: 1, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  assert.equal(Buffer.from(data).toString('hex'), 'aa3366');

  // A resume's own domain never shows the landing page, so nor does its icon.
  svg = await svgOf('sales.example');
  assert.equal(initials(svg), 'SS');
  assert.equal(tileColor(svg), '#884400');

  // With no name on the default resume, the page's headline stands in.
  store.setHeader({ name: '', title: 'Engineer' });
  await store.publish();
  assert.equal(initials(await svgOf('jo.example')), 'HJ');

  // Switched off, `/` is the resume again: no name, so the neutral mark.
  store.setLandingEnabled(false);
  svg = await svgOf('jo.example');
  assert.equal(initials(svg), null);
  assert.equal(tileColor(svg), '#225588');
});

test('a store that throws gets the neutral icon, not a 500', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const broken = new Proxy({}, {
      get() {
        return () => {
          throw new Error('SQLITE_BUSY');
        };
      },
    });
    const on = serve(faviconRoutes(broken));
    for (const route of ['/favicon.svg', '/apple-touch-icon.png']) {
      const res = await get(route, { on });
      assert.equal(res.status, 200, route);
      assert.equal(res.headers['cache-control'], 'no-cache', route);
    }
    const svg = (await get('/favicon.svg', { on })).text;
    assert.equal(initials(svg), null);
    assert.equal(tileColor(svg), NEUTRAL_COLORS.accent);
    assert.ok(errors.length >= 2, 'logged');
  } finally {
    console.error = original;
  }
});

test('a failed render is a 500 that still carries the cache headers', async () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    const raster = { pngFor: async () => { throw new Error('librsvg says no'); } };
    const on = serve(faviconRoutes(store, { raster }));
    const res = await get('/apple-touch-icon.png', { on });
    assert.equal(res.status, 500);
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.match(res.headers.vary, /\bHost\b/);
  } finally {
    console.error = original;
  }
});
