import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, getSetting, setSetting, touchDraft, rowToBlock, orderBlocksHierarchically } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { promotedBlockPositions } from '../blockDeletion.js';

const router = Router();

// Only these types can be nested under a heading; `heading` itself can't
// (no multi-level nesting) and `summary` stays top-level only.
const NESTABLE_TYPES = new Set(['experience', 'skills_group', 'education', 'custom']);

function lookupParentRow(parentId) {
  return db.prepare('SELECT * FROM blocks WHERE id = ?').get(parentId);
}

// Throws (with an http status) if parentId isn't a valid parent for a block
// of the given type — null/undefined is always fine (top-level). `lookup`
// defaults to a fresh SQLite query per call, which is fine for the
// single-block routes below; /blocks/reorder already has every row loaded
// in memory and passes a map lookup instead to avoid one query per item.
function assertValidParent(parentId, type, lookup = lookupParentRow) {
  if (parentId == null) return;
  if (typeof parentId !== 'string') {
    // Without this, a non-string parentId (object/array) reaches the
    // SQLite bind below and better-sqlite3 throws its own error — a raw
    // 500 with an internal message, instead of a clean, stable 400.
    const err = new Error('parentId must be a string');
    err.status = 400;
    throw err;
  }
  if (!NESTABLE_TYPES.has(type)) {
    const err = new Error(`${type} blocks can't be nested under a heading`);
    err.status = 400;
    throw err;
  }
  const parent = lookup(parentId);
  if (!parent) {
    const err = new Error('parentId does not reference an existing block');
    err.status = 400;
    throw err;
  }
  if (parent.type !== 'heading') {
    const err = new Error('parentId must reference a heading block');
    err.status = 400;
    throw err;
  }
  if (parent.parent_id != null) {
    // The API never lets a heading itself take a parentId, so this only
    // fires against a heading that got one some other way (hand-edited
    // SQLite, imported data) — without this check, nesting under it would
    // silently produce two levels of nesting despite the documented
    // one-level guarantee.
    const err = new Error('parentId must reference a top-level heading block');
    err.status = 400;
    throw err;
  }
}

function nextPosition(parentId) {
  const row =
    parentId == null
      ? db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM blocks WHERE parent_id IS NULL').get()
      : db.prepare('SELECT COALESCE(MAX(position), -1) AS m FROM blocks WHERE parent_id = ?').get(parentId);
  return row.m + 1;
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
  res.json({ blocks: orderBlocksHierarchically(rows.map(rowToBlock)) });
});

router.post('/blocks', (req, res) => {
  const { type, data, parentId = null } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type is required' });
  try {
    assertValidParent(parentId, type);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO blocks (id, type, position, parent_id, visible_web, visible_print, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)`
  ).run(id, type, nextPosition(parentId), parentId, JSON.stringify(data || {}), now, now);
  touchDraft();
  const row = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
  res.status(201).json({ block: rowToBlock(row) });
});

router.put('/blocks/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Block not found' });

  const { data, visibleWeb, visiblePrint } = req.body || {};
  const parentIdProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'parentId');
  const parentId = parentIdProvided ? req.body.parentId : undefined;
  if (parentIdProvided) {
    try {
      assertValidParent(parentId, existing.type);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE blocks SET
       data = COALESCE(?, data),
       visible_web = COALESCE(?, visible_web),
       visible_print = COALESCE(?, visible_print),
       parent_id = ?,
       position = ?,
       updated_at = ?
     WHERE id = ?`
  ).run(
    data !== undefined ? JSON.stringify(data) : null,
    visibleWeb !== undefined ? (visibleWeb ? 1 : 0) : null,
    visiblePrint !== undefined ? (visiblePrint ? 1 : 0) : null,
    parentIdProvided ? parentId : existing.parent_id,
    // Re-parenting drops the block at the end of its new sibling group;
    // fine-grained ordering within a group happens via /blocks/reorder.
    parentIdProvided && parentId !== existing.parent_id ? nextPosition(parentId) : existing.position,
    now,
    id
  );
  touchDraft();
  const row = db.prepare('SELECT * FROM blocks WHERE id = ?').get(id);
  res.json({ block: rowToBlock(row) });
});

router.delete('/blocks/:id', (req, res) => {
  const { id } = req.params;
  const txn = db.transaction(() => {
    // Promote children in place to match the editor's optimistic deletion.
    // Reindex the top-level siblings from the existing display order so the
    // promoted entries don't jump to the bottom on refresh or publication.
    const hasChildren = db.prepare('SELECT 1 FROM blocks WHERE parent_id = ? LIMIT 1').get(id);
    if (hasChildren) {
      const rows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
      const ordered = orderBlocksHierarchically(rows.map(rowToBlock));
      const promote = db.prepare('UPDATE blocks SET parent_id = NULL, position = ? WHERE id = ?');
      for (const block of promotedBlockPositions(ordered, id)) {
        promote.run(block.position, block.id);
      }
    }
    db.prepare('DELETE FROM blocks WHERE id = ?').run(id);
  });
  txn();
  touchDraft();
  res.json({ ok: true });
});

router.post('/blocks/reorder', (req, res) => {
  const { items } = req.body || {};
  const isValidItem = (item) =>
    item &&
    typeof item.id === 'string' &&
    (item.parentId === null || item.parentId === undefined || typeof item.parentId === 'string');
  if (!Array.isArray(items) || items.some((item) => !isValidItem(item))) {
    return res
      .status(400)
      .json({ error: 'items must be an array of { id, parentId }, parentId being a string, null, or omitted' });
  }

  const rows = db.prepare('SELECT * FROM blocks').all();
  const typeById = new Map(rows.map((r) => [r.id, r.type]));
  const rowById = new Map(rows.map((r) => [r.id, r]));

  // `items` is documented (README) as the full desired display order, not a
  // partial patch — a duplicate or missing id would otherwise leave
  // sibling-group positions inconsistent (gaps, or two blocks sharing one).
  const seen = new Set();
  for (const { id } of items) {
    if (!typeById.has(id)) return res.status(400).json({ error: `unknown block id: ${id}` });
    if (seen.has(id)) return res.status(400).json({ error: `duplicate block id: ${id}` });
    seen.add(id);
  }
  if (seen.size !== typeById.size) {
    return res.status(400).json({ error: 'items must include every existing block exactly once' });
  }

  for (const { id, parentId } of items) {
    try {
      assertValidParent(parentId ?? null, typeById.get(id), (pid) => rowById.get(pid));
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
  }

  const update = db.prepare('UPDATE blocks SET parent_id = ?, position = ? WHERE id = ?');
  const txn = db.transaction((entries) => {
    const counters = new Map();
    for (const { id, parentId } of entries) {
      const key = parentId ?? null;
      const position = counters.get(key) ?? 0;
      counters.set(key, position + 1);
      update.run(key, position, id);
    }
  });
  txn(items);
  touchDraft();
  const updatedRows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
  res.json({ blocks: orderBlocksHierarchically(updatedRows.map(rowToBlock)) });
});

export default router;
