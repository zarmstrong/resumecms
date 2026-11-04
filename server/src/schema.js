// The SQLite schema, as a function of a database handle rather than a
// side effect of importing db.js — so the resume store can be exercised
// against an in-memory database in tests (see resumeStore.test.js) without
// opening the real file under RESUMECMS_DATA_DIR. db.js calls this on boot.
export function ensureSchema(db) {
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

  // A block may nest one level deep under a `heading` block (see
  // resumeStore.js's NESTABLE_TYPES) — NULL means top-level. Added after
  // the initial table, so existing installs need the column added in place;
  // SQLite has no `ADD COLUMN IF NOT EXISTS`, so check first.
  const hasParentId = db
    .prepare("SELECT 1 FROM pragma_table_info('blocks') WHERE name = 'parent_id'")
    .get();
  if (!hasParentId) {
    db.exec('ALTER TABLE blocks ADD COLUMN parent_id TEXT');
  }

  // Several resumes ("variants") can be kept side by side. Each one owns its
  // blocks (blocks.resume_id) and its per-resume settings (header, site,
  // draft_meta, published_resume, pdf_meta in resume_settings); the
  // `settings` table keeps only what's global (credentials, totp, ai).
  // `id` is stable for the resume's life — the slug can be renamed, so
  // nothing points at it. Exactly one resume is the default (what `/`
  // serves); the partial unique index makes "at most one" a database rule,
  // and the store keeps "at least one". Existing installs are moved over
  // by migrateToResumes() (resumeMigration.js).
  db.exec(`
    CREATE TABLE IF NOT EXISTS resumes (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS resumes_one_default ON resumes (is_default) WHERE is_default = 1;

    CREATE TABLE IF NOT EXISTS resume_settings (
      resume_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (resume_id, key)
    );
  `);

  const hasResumeId = db
    .prepare("SELECT 1 FROM pragma_table_info('blocks') WHERE name = 'resume_id'")
    .get();
  if (!hasResumeId) {
    db.exec('ALTER TABLE blocks ADD COLUMN resume_id TEXT');
  }
  db.exec('CREATE INDEX IF NOT EXISTS blocks_by_group ON blocks (resume_id, parent_id, position)');
}
