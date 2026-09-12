import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DATA_DIR = process.env.RESUMECMS_DATA_DIR || '/data';
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'zresume.sqlite3');
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
