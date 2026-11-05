import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mountClient } from './clientStatic.js';
import {
  IMMUTABLE,
  PDF,
  REVALIDATE,
  hashedAssetsWatcher,
  loadHashedAssets,
  looksLikeFile,
  staticCacheControl,
} from './cacheHeaders.js';

test('the public cache policies never let a cache serve without revalidating', () => {
  // Guard against someone "optimizing" these later: both must force a
  // round-trip, and the PDF must additionally stay out of shared caches.
  assert.match(REVALIDATE, /\bno-cache\b/);
  assert.match(PDF, /\bno-cache\b/);
  assert.match(PDF, /\bprivate\b/);
  assert.doesNotMatch(REVALIDATE, /max-age=[1-9]/);
  assert.doesNotMatch(PDF, /max-age=[1-9]/);
});

test('SPA routes are not files; anything with an extension is', () => {
  for (const route of ['/', '/editor', '/print', '/template-preview', '/template-preview/preset/two-column']) {
    assert.equal(looksLikeFile(route), false, route);
  }
  for (const route of ['/robots.txt', '/favicon.ico', '/assets/index-OLDBUILD.js', '/foo/bar.css', '/x.js/']) {
    assert.equal(looksLikeFile(route), true, route);
  }
});

// A throwaway "dist" folder shaped like Vite's output (manifest included),
// served over a real socket so express.static/sendFile set their headers
// for real. It sits under a dot directory on purpose: the SPA fallback must
// still serve index.html from a checkout like .claude/worktrees/<name>.
const dotDir = fs.mkdtempSync(path.join(os.tmpdir(), '.resumecms-'));
const dist = path.join(dotDir, 'dist');
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
fs.mkdirSync(path.join(dist, '.vite'));
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>t</title>');
fs.writeFileSync(path.join(dist, 'assets', 'index-BgiGnxZ3.js'), 'console.log(1)');
fs.writeFileSync(path.join(dist, 'assets', 'index-xAS2U7I9.css'), 'body{}');
fs.writeFileSync(path.join(dist, 'assets', 'Inter-C3fLQp8G.woff2'), 'font');
// Copied verbatim from public/assets/: not in the manifest, so an edit to
// it must reach browsers even though the name looks hashed.
fs.writeFileSync(path.join(dist, 'assets', 'banner-2024v12A.png'), 'png');
fs.writeFileSync(path.join(dist, 'favicon.ico'), 'icon');
fs.writeFileSync(
  path.join(dist, '.vite', 'manifest.json'),
  JSON.stringify({
    'index.html': {
      file: 'assets/index-BgiGnxZ3.js',
      css: ['assets/index-xAS2U7I9.css'],
      assets: ['assets/Inter-C3fLQp8G.woff2'],
      isEntry: true,
      src: 'index.html',
    },
  })
);

test('the manifest decides what is hashed; nothing else is', () => {
  const hashed = loadHashedAssets(dist);
  assert.deepEqual(
    [...hashed].sort(),
    ['assets/Inter-C3fLQp8G.woff2', 'assets/index-BgiGnxZ3.js', 'assets/index-xAS2U7I9.css'].map((f) => path.join(dist, f)).sort()
  );
  assert.equal(staticCacheControl(path.join(dist, 'assets', 'index-BgiGnxZ3.js'), hashed), IMMUTABLE);
  assert.equal(staticCacheControl(path.join(dist, 'assets', 'banner-2024v12A.png'), hashed), REVALIDATE);
  assert.equal(staticCacheControl(path.join(dist, 'index.html'), hashed), REVALIDATE);
  // No manifest at all (an older build): nothing is immutable.
  assert.equal(loadHashedAssets(path.join(dotDir, 'nowhere')).size, 0);
});

test('a rebuilt manifest is picked up without a restart', () => {
  const other = path.join(dotDir, 'rebuilt');
  fs.mkdirSync(path.join(other, '.vite'), { recursive: true });
  const manifest = path.join(other, '.vite', 'manifest.json');
  const write = (file, mtime) => {
    fs.writeFileSync(manifest, JSON.stringify({ 'index.html': { file } }));
    fs.utimesSync(manifest, mtime, mtime);
  };
  const hashed = hashedAssetsWatcher(other);
  assert.equal(hashed().size, 0); // nothing built yet
  write('assets/index-AAAAAAAA.js', new Date('2026-01-01T00:00:00Z'));
  assert.deepEqual([...hashed()], [path.join(other, 'assets/index-AAAAAAAA.js')]);
  assert.equal(hashed(), hashed()); // unchanged manifest: same set, not re-read
  write('assets/index-BBBBBBBB.js', new Date('2026-01-02T00:00:00Z'));
  assert.deepEqual([...hashed()], [path.join(other, 'assets/index-BBBBBBBB.js')]);
  fs.rmSync(manifest);
  assert.equal(hashed().size, 0);
});

const app = express();
mountClient(app, dist);
const server = app.listen(0);
const base = () => `http://127.0.0.1:${server.address().port}`;
after(() => {
  server.close();
  fs.rmSync(dotDir, { recursive: true, force: true });
});

test('manifest-listed bundles are immutable, everything else revalidates', async () => {
  for (const route of ['/assets/index-BgiGnxZ3.js', '/assets/index-xAS2U7I9.css', '/assets/Inter-C3fLQp8G.woff2']) {
    const res = await fetch(`${base()}${route}`);
    assert.equal(res.status, 200, route);
    assert.equal(res.headers.get('cache-control'), IMMUTABLE, route);
  }
  for (const route of ['/favicon.ico', '/assets/banner-2024v12A.png']) {
    const res = await fetch(`${base()}${route}`);
    assert.equal(res.status, 200, route);
    assert.equal(res.headers.get('cache-control'), REVALIDATE, route);
  }
});

test('a missing file (e.g. a bundle from an older build) is a 404, not the HTML shell', async () => {
  for (const route of ['/assets/index-OLDBUILD.js', '/robots.txt', '/editor/x.css', '/.vite/manifest.json']) {
    const res = await fetch(`${base()}${route}`);
    assert.equal(res.status, 404, route);
    assert.doesNotMatch(res.headers.get('content-type'), /html/, route);
    assert.equal(res.headers.get('cache-control'), REVALIDATE, route);
  }
});

test('a directory path is not redirected; it falls through like any unknown route', async () => {
  const res = await fetch(`${base()}/assets`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), REVALIDATE);
  assert.match(res.headers.get('content-type'), /html/);
});

test('the HTML shell revalidates on / and on client-side routes, with an ETag for 304s', async () => {
  for (const route of ['/', '/editor', '/print', '/template-preview/preset/two-column', '/index.html']) {
    const res = await fetch(`${base()}${route}`);
    assert.equal(res.status, 200, route);
    assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8', route);
    assert.equal(res.headers.get('cache-control'), REVALIDATE, route);
    assert.ok(res.headers.get('etag'), route);
  }
  const first = await fetch(`${base()}/`);
  // Plain node:http here: fetch() silently adds `Cache-Control: no-cache`
  // to any request carrying If-None-Match (per the Fetch spec), which
  // Express's freshness check honours by always sending the full body.
  const again = await rawStatus(`${base()}/`, { 'If-None-Match': first.headers.get('etag') });
  assert.equal(again, 304);
});

test("a resume's own link (/r/<slug>) is unlisted; every other page is not", async () => {
  for (const route of ['/r/sales', '/r', '/R/sales']) {
    const res = await fetch(`${base()}${route}`);
    assert.equal(res.status, 200, route);
    assert.equal(res.headers.get('x-robots-tag'), 'noindex', route);
  }
  for (const route of ['/', '/editor', '/print', '/resume']) {
    const res = await fetch(`${base()}${route}`);
    assert.equal(res.headers.get('x-robots-tag'), null, route);
  }
});

function rawStatus(url, headers) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
}
