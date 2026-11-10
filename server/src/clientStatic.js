import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { NOINDEX, REVALIDATE, hashedAssetsWatcher, looksLikeFile, staticCacheControl } from './cacheHeaders.js';
import { HOST_HEADERS } from './hostnames.js';

// index.html's text, re-read whenever its mtime changes (as
// hashedAssetsWatcher re-reads the manifest), so a rebuild under a running
// server is picked up. Null while there's no file.
export function shellWatcher(indexHtml) {
  let loadedMtime = null;
  let html = null;
  return () => {
    let mtime = null;
    try {
      mtime = fs.statSync(indexHtml).mtimeMs;
    } catch {
      return null;
    }
    if (mtime !== loadedMtime) {
      try {
        html = fs.readFileSync(indexHtml, 'utf8');
        loadedMtime = mtime;
      } catch {
        return null;
      }
    }
    return html;
  };
}

// `html` with a page's own head tags (shellHead.js) in place of its
// generic <title>, or added at the end of its head if it has none.
export function withHead(html, head) {
  if (/<title>[\s\S]*?<\/title>/i.test(html)) return html.replace(/<title>[\s\S]*?<\/title>/i, () => head);
  return html.replace(/<\/head>/i, () => `${head}\n  </head>`);
}

// `html` with index.html's links to the site's icons (routes/favicon.js)
// carrying a `?v=` each (issue #108): `versions` is { svg, png } from
// faviconContent.js's createIconVersions(), or null to keep the bare paths.
// A CDN that caches by extension (Cloudflare does .svg and .png for hours)
// then sees a new URL whenever a publish changes the icon.
const ICON_LINKS = { svg: '/favicon.svg', png: '/apple-touch-icon.png' };
export function withIconVersions(html, versions) {
  if (!versions) return html;
  let out = html;
  for (const [key, href] of Object.entries(ICON_LINKS)) {
    if (!versions[key]) continue;
    out = out.replaceAll(`href="${href}"`, () => `href="${href}?v=${encodeURIComponent(versions[key])}"`);
  }
  return out;
}

// Serve the built client (Vite output) for everything the API routes didn't
// claim, including client-side routes like /editor and /print — the SPA
// router handles them. Hashed bundles (per Vite's manifest) are immutable;
// the HTML shell and any unhashed file are revalidated on every load so a
// new build (new bundle names in index.html) is picked up immediately.
// `index: false` sends `/` through the same fallback as every other route
// instead of letting express.static answer it with its own defaults, and
// `redirect: false` keeps it from answering a directory path (`/assets`)
// with a 301 that carries no cache policy of ours.
//
// `headFor(req)` (shellHead.js) gives a public page's own title,
// description and link-preview tags, or null to keep index.html's; it
// depends on the host (which resume, which origin in the URLs), so every
// shell response varies on it. So does `iconVersions(req)`, the icon
// links' versions (see withIconVersions()), which every shell gets, the
// generic ones included, since every page shows the icon.
export function mountClient(app, clientDist, { headFor = () => null, iconVersions = () => null } = {}) {
  const hashedAssets = hashedAssetsWatcher(clientDist);
  app.use(
    express.static(clientDist, {
      index: false,
      redirect: false,
      setHeaders(res, filePath) {
        res.setHeader('Cache-Control', staticCacheControl(filePath, hashedAssets()));
      },
    })
  );

  // Express 5: `/*splat` alone needs at least one character after the slash,
  // so the braces make it optional and let this answer `/` too. res.send
  // adds an ETag, so an unchanged shell is still a 304.
  const shell = shellWatcher(path.join(clientDist, 'index.html'));
  app.get('/{*splat}', (req, res) => {
    res.set('Cache-Control', REVALIDATE);
    res.vary(HOST_HEADERS);
    // A resume's own link (/r/<slug>) is unlisted; see cacheHeaders.js.
    if (/^\/r(\/|$)/i.test(req.path)) res.set('X-Robots-Tag', NOINDEX);
    const html = looksLikeFile(req.path) ? null : shell();
    if (html === null) {
      // A file express.static didn't find (see looksLikeFile), or no build
      // at all: a plain 404, never the HTML shell.
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const meta = headFor(req);
    if (meta?.noindex) res.set('X-Robots-Tag', NOINDEX);
    const page = withIconVersions(html, iconVersions(req));
    res.type('html').send(meta ? withHead(page, meta.head) : page);
  });
}
