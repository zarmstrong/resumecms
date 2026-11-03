import fs from 'node:fs';
import path from 'node:path';

// Explicit Cache-Control values for everything the public can fetch.
//
// Express's defaults (`public, max-age=0` from sendFile/static, nothing at
// all from res.json) only say "revalidate" — they don't forbid caching, so a
// CDN in front of the app is free to replace them. Cloudflare, for one,
// caches .pdf/.js/.css by extension and rewrites max-age=0 to its zone's
// Browser Cache TTL, which left the old PDF in visitors' browsers for hours
// after a Publish. Stating the policy ourselves takes the guesswork away
// from every cache between the server and the reader.

// JSON and HTML: always revalidate. Express still sets an ETag (and sendFile
// a Last-Modified), so an unchanged response costs a 304, not a full body.
export const REVALIDATE = 'no-cache';

// The published PDF: `private` keeps shared caches (CDN, proxies) from
// storing it at all, `no-cache` makes the browser revalidate its copy.
export const PDF = 'private, no-cache';

// Vite's content-hashed bundles under /assets/: the name changes whenever
// the content does, so these can be cached indefinitely.
export const IMMUTABLE = 'public, max-age=31536000, immutable';

// Which files in the build are content-hashed. A name can't prove it (a
// file copied verbatim from public/assets/ can look like `name-XXXXXXXX.ext`
// too), so this reads the build manifest Vite writes (`build.manifest` in
// client/vite.config.js): it lists exactly the chunks, stylesheets and
// assets Vite emitted, all hashed, and nothing from public/. Returns the
// set of absolute paths; empty when there's no manifest (an older build),
// in which case everything is merely revalidated — slower, never stale.
export function loadHashedAssets(clientDist) {
  const hashed = new Set();
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath(clientDist), 'utf8'));
  } catch {
    return hashed;
  }
  for (const entry of Object.values(manifest)) {
    for (const file of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
      if (typeof file === 'string') hashed.add(path.resolve(clientDist, file));
    }
  }
  return hashed;
}

function manifestPath(clientDist) {
  return path.join(clientDist, '.vite', 'manifest.json');
}

// loadHashedAssets() that re-reads the manifest whenever it changes on
// disk, so a `vite build` under a running server (local dev; the Docker
// image bakes both in and restarts) picks up the new bundle names instead
// of serving them as merely revalidated until a restart. One stat per
// static-file request is the whole cost.
export function hashedAssetsWatcher(clientDist) {
  let loadedMtime = null;
  let hashed = new Set();
  return () => {
    let mtime = null;
    try {
      mtime = fs.statSync(manifestPath(clientDist)).mtimeMs;
    } catch {
      // No manifest: fall through and (re)load into an empty set.
    }
    if (mtime !== loadedMtime) {
      hashed = loadHashedAssets(clientDist);
      loadedMtime = mtime;
    }
    return hashed;
  };
}

export function staticCacheControl(filePath, hashedAssets) {
  return hashedAssets.has(path.resolve(filePath)) ? IMMUTABLE : REVALIDATE;
}

// The SPA's routes (/, /editor, /print, /template-preview/...) never have a
// file extension — a convention new routes must keep — so a last path
// segment with a dot is a request for a file that doesn't exist (a bundle
// from a previous build, /robots.txt, a stray favicon) and must be a 404,
// not a 200 of HTML. A CDN caching by extension could otherwise store HTML
// under a .js URL. Trailing slashes are ignored so `/x.js/` isn't a way in.
export function looksLikeFile(urlPath) {
  const last = urlPath.replace(/\/+$/, '').split('/').pop();
  return last.includes('.');
}
