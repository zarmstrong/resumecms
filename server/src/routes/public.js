import { Router } from 'express';
import { store } from '../store.js';

const router = Router();

// The public site and PDF are rendered from the last-published snapshot, not
// the live draft — the editor writes drafts, and Publish is what promotes a
// draft to here (see resumeStore.js's publish()).
// mode=web -> blocks flagged visible on the web (others become placeholders)
// mode=print -> blocks flagged visible in print/PDF (others become placeholders)
// See publicBlocks.js for why hidden blocks are kept as content-free
// placeholders instead of being dropped.
router.get('/resume', (req, res) => {
  res.json(store.getPublishedResume(req.query.mode));
});

export default router;
