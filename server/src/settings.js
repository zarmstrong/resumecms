// Key/value settings helpers bound to a database handle. db.js binds them
// to the real database and re-exports the result; resumeStore.js binds them
// to whatever handle it's given, so tests can run it against ':memory:'.
export function createSettings(db) {
  function getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  }

  function setSetting(key, value) {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, JSON.stringify(value));
  }

  // Bumped by every draft-mutating store method so the editor can show an
  // "unpublished changes" indicator that survives a page reload.
  function touchDraft() {
    setSetting('draft_meta', { lastEditedAt: new Date().toISOString() });
  }

  return { getSetting, setSetting, touchDraft };
}
