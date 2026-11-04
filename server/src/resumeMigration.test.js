import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ensureSchema } from './schema.js';
import { migrateToResumes, adoptLegacyRows, DEFAULT_SLUG } from './resumeMigration.js';
import { pdfPathFor } from './pdfPaths.js';
import { createResumeStore } from './resumeStore.js';

// An install from before resume variants: the old two-table schema (no
// resume_id, no resumes/resume_settings), its content in global settings
// and unowned blocks, and a PDF at <data>/resume.pdf. ensureSchema() then
// runs over it exactly as db.js does on the first boot after upgrading.
function legacyInstall() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE blocks (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, position INTEGER NOT NULL,
      visible_web INTEGER NOT NULL DEFAULT 1, visible_print INTEGER NOT NULL DEFAULT 1,
      data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, parent_id TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  const insert = db.prepare(
    "INSERT INTO blocks (id, type, position, parent_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'x', 'x')"
  );
  insert.run('h', 'heading', 0, null, '{"text":"Experience"}');
  insert.run('e', 'experience', 0, 'h', '{"jobTitle":"Dev"}');
  insert.run('s', 'summary', 1, null, '{"text":"Hi"}');
  const settings = {
    header: { name: 'Zed' },
    site: { title: 'Zed', colors: { accent: '#000000' } },
    draft_meta: { lastEditedAt: '2026-02-01T00:00:00.000Z' },
    published_resume: { header: { name: 'Zed' }, site: {}, blocks: [], publishedAt: '2026-01-01T00:00:00.000Z' },
    pdf_meta: { renderedFor: '2026-01-01T00:00:00.000Z' },
    credentials: { username: 'zed', passwordHash: 'h' },
    totp: { secret: 's', enabled: true },
    ai: { provider: 'openai' },
  };
  for (const [key, value] of Object.entries(settings)) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resumecms-migrate-'));
  const legacyPdfPath = path.join(dataDir, 'resume.pdf');
  fs.writeFileSync(legacyPdfPath, '%PDF-legacy');
  ensureSchema(db);
  return { db, settings, dataDir, legacyPdfPath, pdfDir: path.join(dataDir, 'pdf') };
}

test('an existing install becomes the default resume, unchanged', () => {
  const { db, settings, legacyPdfPath, pdfDir } = legacyInstall();
  const id = migrateToResumes(db, { pdfDir, legacyPdfPath });

  const resume = db.prepare('SELECT * FROM resumes').get();
  assert.equal(resume.id, id);
  assert.equal(resume.slug, DEFAULT_SLUG);
  assert.equal(resume.is_default, 1);
  assert.equal(resume.is_public, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resumes').get().n, 1);

  assert.deepEqual(
    db.prepare('SELECT id, resume_id FROM blocks ORDER BY id').all(),
    ['e', 'h', 's'].map((blockId) => ({ id: blockId, resume_id: id }))
  );

  // The per-resume settings moved byte-for-byte; the global ones stayed.
  const moved = Object.fromEntries(
    db.prepare('SELECT key, value FROM resume_settings WHERE resume_id = ?').all(id).map((r) => [r.key, JSON.parse(r.value)])
  );
  assert.deepEqual(moved, {
    header: settings.header,
    site: settings.site,
    draft_meta: settings.draft_meta,
    published_resume: settings.published_resume,
    pdf_meta: settings.pdf_meta,
  });
  assert.deepEqual(db.prepare('SELECT key FROM settings ORDER BY key').all().map((r) => r.key), ['ai', 'credentials', 'totp']);

  assert.equal(fs.existsSync(legacyPdfPath), false);
  assert.equal(fs.readFileSync(pdfPathFor(pdfDir, id), 'utf8'), '%PDF-legacy');
});

test('after migrating, the store serves exactly what the install served before', () => {
  const { db, legacyPdfPath, pdfDir } = legacyInstall();
  const id = migrateToResumes(db, { pdfDir, legacyPdfPath });
  const store = createResumeStore({ db, pdfDir, renderPdf: async () => Buffer.from('x') });
  assert.equal(store.defaultResumeId(), id);
  assert.deepEqual(store.getHeader(), { name: 'Zed' });
  assert.deepEqual(store.listBlocks().map((b) => [b.id, b.parentId]), [['h', null], ['e', 'h'], ['s', null]]);
  assert.deepEqual(store.getPublishStatus(), {
    publishedAt: '2026-01-01T00:00:00.000Z',
    isDirty: true,
    pdfStale: false,
    pdfVersion: store.getPublishStatus().pdfVersion,
  });
  assert.ok(store.getPublishStatus().pdfVersion);
  assert.deepEqual(store.getPdfFile(), { path: pdfPathFor(pdfDir, id), name: 'Zed' });
});

test('migrating again is a no-op', () => {
  const { db, legacyPdfPath, pdfDir } = legacyInstall();
  const id = migrateToResumes(db, { pdfDir, legacyPdfPath });
  // ensureSchema runs on every boot too.
  ensureSchema(db);
  db.prepare("INSERT INTO settings (key, value) VALUES ('header', '{}')").run();
  assert.equal(migrateToResumes(db, { pdfDir, legacyPdfPath }), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resumes').get().n, 1);
  assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM resume_settings WHERE resume_id = ? AND key = 'header'").get(id).value), { name: 'Zed' });
});

test('an install with no PDF yet migrates without one', () => {
  const { db, legacyPdfPath, pdfDir } = legacyInstall();
  fs.rmSync(legacyPdfPath);
  const id = migrateToResumes(db, { pdfDir, legacyPdfPath });
  assert.ok(id);
  assert.equal(fs.existsSync(pdfPathFor(pdfDir, id)), false);
});

test('a failed migration puts the PDF back and leaves the database as it was', () => {
  const { db, legacyPdfPath, pdfDir } = legacyInstall();
  // Make the transaction fail part-way: a resume_settings row that the
  // migration's insert collides with can't exist (no resume yet), so break
  // the table itself instead.
  db.exec('DROP TABLE resume_settings');
  assert.throws(() => migrateToResumes(db, { pdfDir, legacyPdfPath }), /no such table/);
  assert.equal(fs.readFileSync(legacyPdfPath, 'utf8'), '%PDF-legacy');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resumes').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM blocks WHERE resume_id IS NOT NULL').get().n, 0);
  assert.ok(db.prepare("SELECT 1 FROM settings WHERE key = 'header'").get());
});

test('rows written by pre-variant code after the migration: blocks are adopted, settings only reported', () => {
  const { db, legacyPdfPath, pdfDir } = legacyInstall();
  const id = migrateToResumes(db, { pdfDir, legacyPdfPath });
  assert.deepEqual(adoptLegacyRows(db), { adopted: 0, legacyKeys: [] });

  // What a rolled-back image would write: an unowned block and a global header.
  db.prepare(
    "INSERT INTO blocks (id, type, position, data, created_at, updated_at) VALUES ('late', 'summary', 2, '{}', 'x', 'x')"
  ).run();
  db.prepare(`INSERT INTO settings (key, value) VALUES ('header', '{"name":"Placeholder"}')`).run();

  assert.deepEqual(adoptLegacyRows(db), { adopted: 1, legacyKeys: ['header'] });
  assert.equal(db.prepare("SELECT resume_id FROM blocks WHERE id = 'late'").get().resume_id, id);
  const store = createResumeStore({ db, pdfDir, renderPdf: async () => Buffer.from('x') });
  assert.deepEqual(store.getHeader(), { name: 'Zed' });
  assert.ok(store.getBlock('late'));
});
