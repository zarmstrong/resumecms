// Bullets used to be plain strings; normalize old data so it still renders
// and edits cleanly without a DB migration.
export function normalizeBullet(bullet) {
  if (typeof bullet === 'string') {
    return { text: bullet, visibleWeb: true, visiblePrint: true };
  }
  return {
    text: bullet.text || '',
    visibleWeb: bullet.visibleWeb !== false,
    visiblePrint: bullet.visiblePrint !== false,
  };
}
