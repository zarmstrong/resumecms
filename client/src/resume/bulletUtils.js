// Bullets used to be plain strings; normalize old data so it still renders
// and edits cleanly without a DB migration.
//
// Bullets can nest one level deep (2 levels total). `depth` tracks how deep
// we already are so a stray third level in old/malformed data gets dropped
// instead of rendering an unbounded tree.
export const MAX_BULLET_DEPTH = 1;

export function normalizeBullet(bullet, depth = 0) {
  if (typeof bullet === 'string') {
    return { text: bullet, visibleWeb: true, visiblePrint: true, children: [] };
  }
  return {
    text: bullet.text || '',
    visibleWeb: bullet.visibleWeb !== false,
    visiblePrint: bullet.visiblePrint !== false,
    children:
      depth < MAX_BULLET_DEPTH && Array.isArray(bullet.children)
        ? bullet.children.map((child) => normalizeBullet(child, depth + 1))
        : [],
  };
}
