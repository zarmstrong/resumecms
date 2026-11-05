import { Router } from 'express';
import { store } from '../store.js';
import { NOINDEX } from '../cacheHeaders.js';
import { sendResumePdf } from './sendPdf.js';
import { HOST_HEADERS } from '../hostnames.js';

const router = Router();

// The PDF of whichever resume this host shows (see the store's forHost),
// so a cache has to tell hosts apart.
router.get('/resume.pdf', (req, res) => {
  res.vary(HOST_HEADERS);
  sendResumePdf(res, () => store.forHost(req.hostname));
});

// The PDF of a public resume by its link name (/r/<slug>); unlisted, like
// its page.
router.get('/resumes/:slug/resume.pdf', (req, res) => {
  res.set('X-Robots-Tag', NOINDEX);
  sendResumePdf(res, () => store.forPublicSlug(req.params.slug));
});

export default router;
