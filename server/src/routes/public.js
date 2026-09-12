import { Router } from 'express';
import { db, getSetting } from '../db.js';

const router = Router();

function rowToBlock(row) {
  return {
    id: row.id,
    type: row.type,
    position: row.position,
    visibleWeb: !!row.visible_web,
    visiblePrint: !!row.visible_print,
    data: JSON.parse(row.data),
  };
}

// Bullets used to be plain strings; treat those (and bullets missing a flag)
// as visible everywhere so old data keeps rendering without a migration.
function bulletVisible(bullet, mode) {
  if (typeof bullet === 'string') return true;
  return mode === 'print' ? bullet.visiblePrint !== false : bullet.visibleWeb !== false;
}

function filterBulletsForMode(block, mode) {
  if (block.type !== 'experience' || !Array.isArray(block.data.bullets)) return block;
  return {
    ...block,
    data: {
      ...block.data,
      bullets: block.data.bullets
        .filter((b) => bulletVisible(b, mode))
        .map((b) => (typeof b === 'string' ? b : b.text)),
    },
  };
}

// mode=web -> only blocks flagged visible on the web
// mode=print -> only blocks flagged visible in print/PDF
router.get('/resume', (req, res) => {
  const mode = req.query.mode === 'print' ? 'print' : 'web';
  const rows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
  const blocks = rows
    .map(rowToBlock)
    .filter((b) => (mode === 'print' ? b.visiblePrint : b.visibleWeb))
    .map((b) => filterBulletsForMode(b, mode));

  res.json({
    header: getSetting('header'),
    site: getSetting('site'),
    blocks,
  });
});

export default router;
