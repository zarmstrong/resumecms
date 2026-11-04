import { Router } from 'express';
import { store } from '../store.js';
import { REVALIDATE, RENDER } from '../cacheHeaders.js';
import { RENDERED_RESUME_HEADER, renderTarget } from '../renderAccess.js';
import { handle } from './sendError.js';

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
  const renderingId = renderTarget(req.headers.cookie);
  res.set('Cache-Control', renderingId ? RENDER : REVALIDATE);
  const resume = renderingId ? store.forResume(renderingId) : store;
  const published = resume.getPublishedResume(req.query.mode);
  if (renderingId) res.set(RENDERED_RESUME_HEADER, renderingId);
  res.json(published);
}));

export default router;
