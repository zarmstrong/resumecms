import { Router } from 'express';
import { REVALIDATE } from '../cacheHeaders.js';
import { HOST_HEADERS } from '../hostnames.js';
import { APPLE_TOUCH_SIZE, etagOf, faviconSvg, iconContent } from '../favicon.js';
import { iconContentFor } from '../faviconContent.js';
import { createFaviconRaster } from '../faviconRaster.js';
import { handle } from './sendError.js';

// The site's icon (issue #104): /favicon.svg and /apple-touch-icon.png,
// both drawn from favicon.js's SVG, over any store so a test can drive
// them over :memory:. index.js mounts this ahead of the client: the SPA
// fallback 404s any path with a file extension.
//
// What the icon shows is faviconContent.js's iconContentFor(): what `/`
// shows on the host, and only ever what's published. A store that throws
// gets the neutral icon, never a 500, like shellHead.js.
//
// Both depend on the host, so both vary on it, and both revalidate with a
// strong ETag of the bytes sent: a rename or a recolor is a new ETag. The
// HTML shell links them with a `?v=` of the same content (issue #108,
// createIconVersions()), which nothing here reads: the path alone picks
// the response, so a versioned URL gets the same bytes, headers and ETag.
export function faviconRoutes(store, { raster = createFaviconRaster({ size: APPLE_TOUCH_SIZE }) } = {}) {
  function contentFor(hostname) {
    try {
      return iconContentFor(store, hostname);
    } catch (err) {
      console.error('Could not work out the favicon:', err);
      return iconContent();
    }
  }

  // Set before anything can fail, so an error response carries them too.
  function commonHeaders(res) {
    res.set('Cache-Control', REVALIDATE);
    res.vary(HOST_HEADERS);
    res.set('X-Content-Type-Options', 'nosniff');
  }

  const router = Router();

  router.get('/favicon.svg', (req, res) => {
    commonHeaders(res);
    // Opened on its own, an SVG is a document: it may run nothing and load
    // nothing, only its own inline style.
    res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    const svg = faviconSvg(contentFor(req.hostname));
    res.set('ETag', etagOf(svg));
    res.type('image/svg+xml').send(svg);
  });

  // res.send answers a matching If-None-Match with a 304 (req.fresh).
  router.get('/apple-touch-icon.png', handle(async (req, res) => {
    commonHeaders(res);
    const { bytes, etag } = await raster.pngFor(faviconSvg(contentFor(req.hostname), { forRaster: true }));
    res.set('ETag', etag);
    res.type('image/png').send(bytes);
  }));

  return router;
}
