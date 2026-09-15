import { Router } from 'express';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { db, getSetting, setSetting, rowToBlock, orderBlocksHierarchically } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { renderResumePdf } from '../pdfRenderer.js';
import { PDF_PATH } from './pdf.js';

const router = Router();

function currentDraft() {
  const rows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
  return {
    header: getSetting('header'),
    site: getSetting('site'),
    blocks: orderBlocksHierarchically(rows.map(rowToBlock)),
  };
}

function isDirty() {
  const draftMeta = getSetting('draft_meta');
  const published = getSetting('published_resume');
  if (!draftMeta?.lastEditedAt) return false;
  if (!published?.publishedAt) return true;
  return draftMeta.lastEditedAt > published.publishedAt;
}

// All routes below require an authenticated editor session.
router.use(requireAuth);

router.get('/publish/status', (req, res) => {
  const published = getSetting('published_resume');
  res.json({ publishedAt: published?.publishedAt ?? null, isDirty: isDirty() });
});

router.post('/publish', async (req, res) => {
  try {
    const publishedAt = new Date().toISOString();
    setSetting('published_resume', { ...currentDraft(), publishedAt });

    const pdfBuffer = await renderResumePdf();
    fs.writeFileSync(PDF_PATH, pdfBuffer);

    res.json({ publishedAt });
  } catch (err) {
    console.error('Publish failed:', err);
    res.status(500).json({ error: 'Publish failed' });
  }
});

router.post('/discard-draft', (req, res) => {
  const published = getSetting('published_resume');
  if (!published) return res.status(409).json({ error: 'Nothing has been published yet' });

  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO blocks (id, type, position, parent_id, visible_web, visible_print, data, created_at, updated_at)
    VALUES (@id, @type, @position, @parentId, @visibleWeb, @visiblePrint, @data, @now, @now)
  `);
  const txn = db.transaction((blocks) => {
    db.prepare('DELETE FROM blocks').run();
    // published.blocks is already in hierarchical order (a heading directly
    // followed by its children), but `position` must be re-derived per
    // sibling group, not from the flat array index.
    const positionByParent = new Map();
    blocks.forEach((block) => {
      const parentId = block.parentId || null;
      const position = positionByParent.get(parentId) ?? 0;
      positionByParent.set(parentId, position + 1);
      insert.run({
        id: block.id || randomUUID(),
        type: block.type,
        position,
        parentId,
        visibleWeb: block.visibleWeb ? 1 : 0,
        visiblePrint: block.visiblePrint ? 1 : 0,
        data: JSON.stringify(block.data),
        now,
      });
    });
  });
  txn(published.blocks);

  setSetting('header', published.header);
  setSetting('site', published.site);
  setSetting('draft_meta', { lastEditedAt: null });

  res.json(currentDraft());
});

export default router;
