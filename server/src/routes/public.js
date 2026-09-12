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

// mode=web -> only blocks flagged visible on the web
// mode=print -> only blocks flagged visible in print/PDF
router.get('/resume', (req, res) => {
  const mode = req.query.mode === 'print' ? 'print' : 'web';
  const rows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
  const blocks = rows
    .map(rowToBlock)
    .filter((b) => (mode === 'print' ? b.visiblePrint : b.visibleWeb));

  res.json({
    header: getSetting('header'),
    site: getSetting('site'),
    blocks,
  });
});

export default router;
