// Key/value settings helpers bound to a database handle. db.js binds them
// to the real database and re-exports the result; resumeStore.js binds
// createResumeSettings() to whatever handle it's given, so tests can run it
// against ':memory:'.
//
// createSettings() is the global `settings` table (credentials, totp, ai).
// createResumeSettings() is one resume's rows in `resume_settings` (header,
// site, draft_meta, published_resume, pdf_meta) with the same interface, so
// the store's code reads the same either way.
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

  return { getSetting, setSetting };
}

// The settings that belong to one resume rather than to the whole install.
export const RESUME_SETTING_KEYS = ['header', 'site', 'draft_meta', 'published_resume', 'pdf_meta'];

export function createResumeSettings(db, resumeId) {
  function getSetting(key) {
    const row = db.prepare('SELECT value FROM resume_settings WHERE resume_id = ? AND key = ?').get(resumeId, key);
    return row ? JSON.parse(row.value) : null;
  }

  function setSetting(key, value) {
    db.prepare(
      `INSERT INTO resume_settings (resume_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(resume_id, key) DO UPDATE SET value = excluded.value`
    ).run(resumeId, key, JSON.stringify(value));
  }

  // Bumped by every draft-mutating store method so the editor can show an
  // "unpublished changes" indicator that survives a page reload — per
  // resume, so editing one variant doesn't mark another as changed.
  function touchDraft() {
    setSetting('draft_meta', { lastEditedAt: new Date().toISOString() });
  }

  return { getSetting, setSetting, touchDraft };
}
