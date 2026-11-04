import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RESUME_SETTING_KEYS } from './settings.js';

// Before resume variants existed, an install held exactly one resume: every
// row in `blocks`, the header/site/draft_meta/published_resume/pdf_meta
// rows in the global `settings` table, and one PDF at `legacyPdfPath`. On
// the first boot with variants, all of that becomes the default resume, so
// an existing install comes up serving exactly what it served before. A
// fresh install goes through here too: db.js seeds the legacy shape first
// and this turns it into the first resume, so there's one path that ever
// creates a default.
//
// A no-op once any resume exists. Takes the handle (not db.js) so
// resumeMigration.test.js can run it against ':memory:'. Returns the
// default resume's id, or null if it didn't run.
export const DEFAULT_SLUG = 'main';
export const DEFAULT_NAME = 'Main resume';

export function pdfPathFor(pdfDir, resumeId) {
  return path.join(pdfDir, `${resumeId}.pdf`);
}

export function migrateToResumes(db, { pdfDir = null, legacyPdfPath = null } = {}) {
  if (db.prepare('SELECT 1 FROM resumes LIMIT 1').get()) return null;

  const id = randomUUID();
  const now = new Date().toISOString();

  // The PDF moves first: if the transaction below then fails, it's moved
  // back, and the next boot tries again from the start. (A crash between
  // the two leaves an unowned pdf/<id>.pdf and no legacy file; the next
  // boot's ensurePdf() renders a fresh one, so nothing is lost but time.)
  let movedPdf = null;
  if (pdfDir && legacyPdfPath && fs.existsSync(legacyPdfPath)) {
    fs.mkdirSync(pdfDir, { recursive: true });
    movedPdf = pdfPathFor(pdfDir, id);
    fs.renameSync(legacyPdfPath, movedPdf);
  }

  const migrate = db.transaction(() => {
    db.prepare(
      `INSERT INTO resumes (id, slug, name, is_default, is_public, created_at, updated_at)
       VALUES (?, ?, ?, 1, 1, ?, ?)`
    ).run(id, DEFAULT_SLUG, DEFAULT_NAME, now, now);
    db.prepare('UPDATE blocks SET resume_id = ? WHERE resume_id IS NULL').run(id);
    const read = db.prepare('SELECT value FROM settings WHERE key = ?');
    const write = db.prepare('INSERT INTO resume_settings (resume_id, key, value) VALUES (?, ?, ?)');
    const remove = db.prepare('DELETE FROM settings WHERE key = ?');
    for (const key of RESUME_SETTING_KEYS) {
      const row = read.get(key);
      if (!row) continue;
      write.run(id, key, row.value);
      remove.run(key);
    }
  });
  try {
    migrate();
  } catch (err) {
    if (movedPdf) fs.renameSync(movedPdf, legacyPdfPath);
    throw err;
  }
  return id;
}
