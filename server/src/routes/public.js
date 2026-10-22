import { Router } from 'express';
import { getSetting } from '../db.js';
import { blocksForMode } from '../publicBlocks.js';

const router = Router();

// The public site and PDF are rendered from the last-published snapshot, not
// the live draft — the editor writes drafts, and Publish is what promotes a
// draft to here (see routes/publish.js).
// mode=web -> blocks flagged visible on the web (others become placeholders)
// mode=print -> blocks flagged visible in print/PDF (others become placeholders)
// See publicBlocks.js for why hidden blocks are kept as content-free
// placeholders instead of being dropped.
router.get('/resume', (req, res) => {
  const mode = req.query.mode === 'print' ? 'print' : 'web';
  const published = getSetting('published_resume') || { header: null, site: null, blocks: [] };

  res.json({
    header: published.header,
    site: published.site,
    blocks: blocksForMode(published.blocks, mode),
  });
});

export default router;
