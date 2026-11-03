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
}
