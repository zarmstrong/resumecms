import { Router } from 'express';
import { store } from '../store.js';
import { NOINDEX, REVALIDATE, RENDER } from '../cacheHeaders.js';
import { RENDERED_RESUME_HEADER, renderTarget } from '../renderAccess.js';
import { handle } from './sendError.js';
import { HOST_HEADERS } from '../hostnames.js';

const router = Router();

// The public site and PDF are rendered from the last-published snapshot, not
// the live draft — the editor writes drafts, and Publish is what promotes a
// draft to here (see resumeStore.js's publish()).
// mode=web -> blocks flagged visible on the web (others become placeholders)
// mode=print -> blocks flagged visible in print/PDF (others become placeholders)
// See publicBlocks.js for why hidden blocks are kept as content-free
// placeholders instead of being dropped.
router.get('/resume', handle((req, res) => {
  // Always revalidate (see cacheHeaders.js), whatever happens below; the
  // ETag res.json adds still turns an unchanged snapshot into a 304.
  // The PDF renderer's own page names the resume it's rendering (see
  // renderAccess.js); that one may be private, so it's never cacheable.
  // Everyone else gets the resume this host shows (see the store's forHost).
  const renderingId = renderTarget(req.headers.cookie);
  res.set('Cache-Control', renderingId ? RENDER : REVALIDATE);
  // Which resume this is depends on the Host header, so a cache has to
  // tell hosts apart (render responses aren't stored at all).
  res.vary(HOST_HEADERS);
  const resume = renderingId ? store.forResume(renderingId) : store.forHost(req.hostname);
  const published = resume.getPublishedResume(req.query.mode);
  if (renderingId) res.set(RENDERED_RESUME_HEADER, renderingId);
  res.json(published);
}));

// A public, published resume by its link name, for /r/<slug>. Unlisted: no
// page links to it, and X-Robots-Tag keeps it out of search results.
router.get('/resumes/:slug', handle((req, res) => {
  res.set('Cache-Control', REVALIDATE);
  res.set('X-Robots-Tag', NOINDEX);
  res.json(store.forPublicSlug(req.params.slug).getPublishedResume(req.query.mode));
}));

export default router;
