import { NOINDEX, REVALIDATE, RENDER } from '../cacheHeaders.js';
import { RENDERED_RESUME_HEADER, renderTarget } from '../renderAccess.js';
import { handle } from './sendError.js';
import { HOST_HEADERS } from '../hostnames.js';

// The two public resume endpoints, over any store (routes/public.js binds
// them to the real one), so a test can drive them over :memory:.
//
// The public site and PDF are rendered from the last-published snapshot, not
// the live draft — the editor writes drafts, and Publish is what promotes a
// draft to here (see resumeStore.js's publish()).
// mode=web -> blocks flagged visible on the web (others become placeholders)
// mode=print -> blocks flagged visible in print/PDF (others become placeholders)
// See publicBlocks.js for why hidden blocks are kept as content-free
// placeholders instead of being dropped.
//
// On the web (any mode but print) a response also carries `home`, the
// link back to the landing page, while this host shows one at `/` (issue
// #89, the store's homeLinkForHost()). Print never does, and nor does the
// PDF renderer's own request, so a PDF never shows it. That makes both
// responses depend on the host, so both send Vary.
export function publicResumeHandlers(store) {
  function withHome(published, req) {
    const home = req.query.mode === 'print' ? null : store.homeLinkForHost(req.hostname);
    return home ? { ...published, home } : published;
  }

  // GET /api/public/resume
  const hostResume = handle((req, res) => {
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
    if (renderingId) {
      const published = store.forResume(renderingId).getPublishedResume(req.query.mode);
      res.set(RENDERED_RESUME_HEADER, renderingId);
      res.json(published);
      return;
    }
    res.json(withHome(store.forHost(req.hostname).getPublishedResume(req.query.mode), req));
  });

  // GET /api/public/resumes/:slug — a public, published resume by its link
  // name, for /r/<slug>. Unlisted: no page links to it, and X-Robots-Tag
  // keeps it out of search results. The resume doesn't depend on the host,
  // but its `home` link does.
  const slugResume = handle((req, res) => {
    res.set('Cache-Control', REVALIDATE);
    res.set('X-Robots-Tag', NOINDEX);
    res.vary(HOST_HEADERS);
    res.json(withHome(store.forPublicSlug(req.params.slug).getPublishedResume(req.query.mode), req));
  });

  return { hostResume, slugResume };
}
