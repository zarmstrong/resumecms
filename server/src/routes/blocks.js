import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, getSetting, setSetting, touchDraft } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';

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

// All routes below require an authenticated editor session.
router.use(requireAuth);

router.get('/header', (req, res) => {
  res.json({ header: getSetting('header') });
});

router.put('/header', (req, res) => {
  setSetting('header', req.body || {});
  touchDraft();
  res.json({ header: getSetting('header') });
});

router.get('/site', (req, res) => {
  res.json({ site: getSetting('site') });
});

router.put('/site', (req, res) => {
  setSetting('site', req.body || {});
  touchDraft();
  res.json({ site: getSetting('site') });
});

router.get('/blocks', (req, res) => {
  const rows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
  res.json({ blocks: rows.map(rowToBlock) });
});

router.post('/blocks', (req, res) => {
  const { type, data } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type is required' });
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM blocks').get().m;
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO blocks (id, type, position, visible_web, visible_print, data, created_at, updated_at)
     VALUES (?, ?, ?, 1, 1, ?, ?, ?)`
  ).run(id, type, maxPos + 1, JSON.stringify(data || {}), now, now);
  touchDraft();
  const row = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
  res.status(201).json({ block: rowToBlock(row) });
});

router.put('/blocks/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Block not found' });

  const { data, visibleWeb, visiblePrint } = req.body || {};
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE blocks SET
       data = COALESCE(?, data),
       visible_web = COALESCE(?, visible_web),
       visible_print = COALESCE(?, visible_print),
       updated_at = ?
     WHERE id = ?`
  ).run(
    data !== undefined ? JSON.stringify(data) : null,
    visibleWeb !== undefined ? (visibleWeb ? 1 : 0) : null,
    visiblePrint !== undefined ? (visiblePrint ? 1 : 0) : null,
    now,
    id
  );
  touchDraft();
  const row = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
  res.json({ block: rowToBlock(row) });
});

router.delete('/blocks/:id', (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
  touchDraft();
  res.json({ ok: true });
});

router.post('/blocks/reorder', (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds must be an array' });
  }
  const update = db.prepare('UPDATE blocks SET position = ? WHERE id = ?');
  const txn = db.transaction((ids) => {
    ids.forEach((id, i) => update.run(i, id));
  });
  txn(orderedIds);
  touchDraft();
  const rows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
  res.json({ blocks: rows.map(rowToBlock) });
});

export default router;
