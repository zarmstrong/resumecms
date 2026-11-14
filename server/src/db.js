import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './passwords.js';
import { ensureSchema } from './schema.js';
import { createSettings } from './settings.js';
import { rowToBlock, orderBlocksHierarchically } from './blockRows.js';
import { DATA_DIR } from './dataDir.js';
import { migrateToResumes, adoptLegacyRows } from './resumeMigration.js';
import { LEGACY_PDF_PATH, PDF_DIR } from './pdfPaths.js';
import { migrateLandingText } from './landingTextMigration.js';
import { SAMPLE_BLOCKS, SAMPLE_HEADER, SAMPLE_SITE } from './sampleContent.js';

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'resume.sqlite3');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

ensureSchema(db);

// The settings helpers and block-row helpers are defined in db-free modules
// (settings.js, blockRows.js) so resumeStore.js can be tested against an
// in-memory database; they're re-exported here so the rest of the server
// keeps importing them from one place. These are the *global* settings
// (credentials, totp, ai); a resume's own settings go through the store.
export const { getSetting, setSetting } = createSettings(db);
export { rowToBlock, orderBlocksHierarchically };

// ---- Seed on first run -----------------------------------------------------

// The placeholder header, site settings and blocks (sampleContent.js).
const defaultHeader = SAMPLE_HEADER;
const defaultSite = SAMPLE_SITE;
const seedBlocks = SAMPLE_BLOCKS;

// Builds the pre-variants, single-resume shape — global header/site
// settings, blocks owned by no resume, and a published snapshot — which
// migrateToResumes() then turns into the default resume. That keeps one
// path for both a fresh install and one upgrading from before variants.
// Only runs while no resume exists: afterwards the global header and
// published_resume rows the migration moved away would be recreated on
// every boot, and deleting every block would re-seed sample blocks that
// belong to no resume.
function seedLegacyResume() {
  function ensureSetting(key, value) {
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!existing) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
    }
  }

  ensureSetting('header', defaultHeader);
  ensureSetting('site', defaultSite);

  if (db.prepare('SELECT COUNT(*) AS n FROM blocks').get().n === 0) {
    const now = new Date().toISOString();
    const insert = db.prepare(`
      INSERT INTO blocks (id, type, position, visible_web, visible_print, data, created_at, updated_at)
      VALUES (@id, @type, @position, 1, 1, @data, @now, @now)
    `);
    seedBlocks.forEach((block, i) => {
      insert.run({
        id: randomUUID(),
        type: block.type,
        position: i,
        data: JSON.stringify(block.data),
        now,
      });
    });
  }

  // The public site and PDF used to be generated straight from the draft
  // tables above (edits went live immediately). Existing installs already
  // have real content in those tables, so on first boot after adding the
  // draft/published split, whatever is currently there becomes the initial
  // published snapshot — otherwise the public site would go blank on deploy.
  if (!getSetting('published_resume')) {
    const rows = db.prepare('SELECT * FROM blocks ORDER BY position ASC').all();
    setSetting('published_resume', {
      header: getSetting('header'),
      site: getSetting('site'),
      blocks: orderBlocksHierarchically(rows.map(rowToBlock)),
      publishedAt: new Date().toISOString(),
    });
  }
}

if (!db.prepare('SELECT 1 FROM resumes LIMIT 1').get()) {
  seedLegacyResume();
  migrateToResumes(db, { pdfDir: PDF_DIR, legacyPdfPath: LEGACY_PDF_PATH });
}

{
  const { adopted, legacyKeys } = adoptLegacyRows(db);
  if (adopted) console.warn(`Attached ${adopted} block(s) with no resume to the default resume.`);
  if (legacyKeys.length) {
    console.warn(
      `WARNING: the global settings table has per-resume rows (${legacyKeys.join(', ')}), probably written by an ` +
        'older version. They are ignored; the default resume reads its own rows in resume_settings.'
    );
  }
}

{
  const escaped = migrateLandingText(db);
  if (escaped) console.warn(`Escaped ${escaped} landing page text field(s) that would otherwise read as links or emphasis.`);
}

// RESUMECMS_ADMIN_USERNAME/RESUMECMS_APP_PASSWORD are only read here, once,
// to seed the real credentials record on first boot. After that the DB is
// the source of truth (see routes/auth.js) — changing the env vars later has
// no effect, so a password change from the editor survives a redeploy.
if (!getSetting('credentials')) {
  const seedUsername = process.env.RESUMECMS_ADMIN_USERNAME;
  const seedPassword = process.env.RESUMECMS_APP_PASSWORD;
  if (seedUsername && seedPassword) {
    setSetting('credentials', { username: seedUsername, passwordHash: hashPassword(seedPassword) });
  }
}
