import { Router } from 'express';
import { REVALIDATE } from '../cacheHeaders.js';
import { HOST_HEADERS } from '../hostnames.js';
import { APPLE_TOUCH_SIZE, etagOf, faviconSvg, iconContent, siteAccent } from '../favicon.js';
import { createFaviconRaster } from '../faviconRaster.js';
import { handle } from './sendError.js';

// The site's icon (issue #104): /favicon.svg and /apple-touch-icon.png,
// both drawn from favicon.js's SVG, over any store so a test can drive
// them over :memory:. index.js mounts this ahead of the client: the SPA
// fallback 404s any path with a file extension.
//
// What the icon shows is asked of the store exactly as `/`'s own fetch
// (GET /api/public/home) asks: the landing page while landingForHost()
// shows it, else forHost()'s resume, and only ever what's published. The
// landing page's name is the default resume's published one (as its
// JSON-LD Person's is), its headline only when that has none, and its
// colors are its resolved `site`: its own palette when it has one, with
// its dark palette's accent under `prefers-color-scheme: dark`. A store
// that throws gets the neutral icon, never a 500, like shellHead.js.
//
// Both depend on the host, so both vary on it, and both revalidate with a
// strong ETag of the bytes sent: a rename or a recolor is a new ETag.
export function faviconRoutes(store, { raster = createFaviconRaster({ size: APPLE_TOUCH_SIZE }) } = {}) {
  function contentFor(hostname) {
    try {
      const landing = store.landingForHost(hostname);
      if (landing) {
        const name = store.getPublishedResume('web').header?.name?.trim() || landing.headline;
        return iconContent({ name, accent: siteAccent(landing.site), darkColors: landing.darkColors });
      }
      const published = store.forHost(hostname).getPublishedResume('web');
      if (!published.header) return iconContent();
      return iconContent({ name: published.header.name, accent: siteAccent(published.site) });
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
