import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashPassword } from './passwords.js';

const DATA_DIR = process.env.RESUMECMS_DATA_DIR || '/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'resume.sqlite3');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    position INTEGER NOT NULL,
    visible_web INTEGER NOT NULL DEFAULT 1,
    visible_print INTEGER NOT NULL DEFAULT 1,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// ---- Seed on first run -----------------------------------------------------
const blockCount = db.prepare('SELECT COUNT(*) AS n FROM blocks').get().n;

const defaultHeader = {
  name: 'Your Name',
  title: 'Your Professional Title',
  subtitle: '',
  location: 'City, State, Country',
  email: 'you@example.com',
  phone: '',
  links: [{ label: 'linkedin.com/in/you', url: 'https://linkedin.com/in/you' }],
};

function ensureSetting(key, value) {
  const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!existing) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
  }
}

ensureSetting('header', defaultHeader);
ensureSetting('site', {
  title: 'My Resume',
  // Cosmetic only — highlights the matching card in the editor's template
  // gallery. Nothing in the rendering path reads this; ResumeView falls
  // back to the "classic" header/layout when template/layout are unset.
  templateId: 'classic',
  colors: {
    accent: '#2f6f4e',
    heading: '#14181c',
    text: '#14181c',
    background: '#ffffff',
  },
});

if (blockCount === 0) {
  const now = new Date().toISOString();
  const seed = [
    { type: 'heading', data: { text: 'Technical Skills' } },
    {
      type: 'skills_group',
      data: { category: 'Technologies', items: 'AWS, Docker, Ansible, Linux, PostgreSQL' },
    },
    { type: 'heading', data: { text: 'Professional Experience' } },
    {
      type: 'experience',
      data: {
        jobTitle: 'Senior Engineer',
        company: 'Example Corp',
        companyUrl: 'https://example.com',
        location: 'Remote',
        startDate: '2022',
        endDate: 'Current',
        tagline: 'A short description of what the company does.',
        bullets: ['Describe an impactful accomplishment.', 'Add another bullet point here.'],
      },
    },
    { type: 'heading', data: { text: 'Education' } },
    {
      type: 'education',
      data: {
        degree: 'B.S. in Your Field',
        institution: 'Your University',
        location: 'City, State',
        startDate: '2010',
        endDate: '2014',
      },
    },
  ];
  const insert = db.prepare(`
    INSERT INTO blocks (id, type, position, visible_web, visible_print, data, created_at, updated_at)
    VALUES (@id, @type, @position, 1, 1, @data, @now, @now)
  `);
  seed.forEach((block, i) => {
    insert.run({
      id: randomUUID(),
      type: block.type,
      position: i,
      data: JSON.stringify(block.data),
      now,
    });
  });
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : null;
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value));
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

// Bumped by every draft-mutating route so the editor can show an
// "unpublished changes" indicator that survives a page reload.
export function touchDraft() {
  setSetting('draft_meta', { lastEditedAt: new Date().toISOString() });
}

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
    blocks: rows.map(rowToBlock),
    publishedAt: new Date().toISOString(),
  });
}
