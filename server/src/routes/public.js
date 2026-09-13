import { Router } from 'express';
import { getSetting } from '../db.js';

const router = Router();

// Bullets used to be plain strings; treat those (and bullets missing a flag)
// as visible everywhere so old data keeps rendering without a migration.
function bulletVisible(bullet, mode) {
  if (typeof bullet === 'string') return true;
  return mode === 'print' ? bullet.visiblePrint !== false : bullet.visibleWeb !== false;
}

// Bullets can nest one level deep (2 levels total). Recurse into `children`
// so nested bullets get the same visibility filtering as top-level ones.
function filterBulletForMode(bullet, mode) {
  if (typeof bullet === 'string') return { text: bullet, children: [] };
  const children = Array.isArray(bullet.children)
    ? bullet.children.filter((c) => bulletVisible(c, mode)).map((c) => filterBulletForMode(c, mode))
    : [];
  return { text: bullet.text, children };
}

function filterBulletsForMode(block, mode) {
  if (block.type !== 'experience' || !Array.isArray(block.data.bullets)) return block;
  return {
    ...block,
    data: {
      ...block.data,
      bullets: block.data.bullets
        .filter((b) => bulletVisible(b, mode))
        .map((b) => filterBulletForMode(b, mode)),
    },
  };
}

// The public site and PDF are rendered from the last-published snapshot, not
// the live draft — the editor writes drafts, and Publish is what promotes a
// draft to here (see routes/publish.js).
// mode=web -> only blocks flagged visible on the web
// mode=print -> only blocks flagged visible in print/PDF
router.get('/resume', (req, res) => {
  const mode = req.query.mode === 'print' ? 'print' : 'web';
  const published = getSetting('published_resume') || { header: null, site: null, blocks: [] };
  const blocks = (published.blocks || [])
    .filter((b) => (mode === 'print' ? b.visiblePrint : b.visibleWeb))
    .map((b) => filterBulletsForMode(b, mode));

  res.json({
    header: published.header,
    site: published.site,
    blocks,
  });
});

export default router;
