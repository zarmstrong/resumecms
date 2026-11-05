import express from 'express';
import path from 'node:path';
import { NOINDEX, REVALIDATE, hashedAssetsWatcher, looksLikeFile, staticCacheControl } from './cacheHeaders.js';

// Serve the built client (Vite output) for everything the API routes didn't
// claim, including client-side routes like /editor and /print — the SPA
// router handles them. Hashed bundles (per Vite's manifest) are immutable;
// the HTML shell and any unhashed file are revalidated on every load so a
// new build (new bundle names in index.html) is picked up immediately.
// `index: false` sends `/` through the same fallback as every other route
// instead of letting express.static answer it with its own defaults, and
// `redirect: false` keeps it from answering a directory path (`/assets`)
// with a 301 that carries no cache policy of ours.
export function mountClient(app, clientDist) {
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

  // The file is a fixed path of ours, not derived from the request, so
  // `dotfiles: 'allow'` is safe — without it sendFile 404s whenever the
  // checkout lives under a dot directory (e.g. a .claude/worktrees clone).
  // (express.static above is unaffected: its dotfiles check only looks at
  // the request path, not the root.)
  // Express 5: `/*splat` alone needs at least one character after the slash,
  // so the braces make it optional and let this answer `/` too.
  const indexHtml = path.join(clientDist, 'index.html');
  app.get('/{*splat}', (req, res) => {
    res.set('Cache-Control', REVALIDATE);
    // A resume's own link (/r/<slug>) is unlisted; see cacheHeaders.js.
    if (/^\/r(\/|$)/i.test(req.path)) res.set('X-Robots-Tag', NOINDEX);
    if (looksLikeFile(req.path)) {
      // A file express.static didn't find (see looksLikeFile): a plain 404,
      // never the HTML shell.
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.sendFile(indexHtml, { cacheControl: false, dotfiles: 'allow' });
  });
}
