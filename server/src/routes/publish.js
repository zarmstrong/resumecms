import { Router } from 'express';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { db, getSetting, setSetting } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { renderResumePdf } from '../pdfRenderer.js';
import { PDF_PATH } from './pdf.js';

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

function currentDraft() {
  const rows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
  return {
    header: getSetting('header'),
    site: getSetting('site'),
    blocks: rows.map(rowToBlock),
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
    INSERT INTO blocks (id, type, position, visible_web, visible_print, data, created_at, updated_at)
    VALUES (@id, @type, @position, @visibleWeb, @visiblePrint, @data, @now, @now)
  `);
  const txn = db.transaction((blocks) => {
    db.prepare('DELETE FROM blocks').run();
    blocks.forEach((block, i) => {
      insert.run({
        id: block.id || randomUUID(),
        type: block.type,
        position: i,
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
