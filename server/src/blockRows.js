// Pure helpers for turning `blocks` rows into API objects and putting them
// in display order. They live apart from db.js (which re-exports them) so
// modules that must not open the real database — resumeStore.js and its
// tests — can import them directly.

export function rowToBlock(row) {
  return {
    id: row.id,
    type: row.type,
    position: row.position,
    parentId: row.parent_id ?? null,
    visibleWeb: !!row.visible_web,
    visiblePrint: !!row.visible_print,
    data: JSON.parse(row.data),
  };
}

// Blocks nest one level deep under a heading. Rather than trust `position`
// (which is only unique within a sibling group, not globally) to interleave
// correctly, walk the tree explicitly: each heading's children are sorted
// by their own position and spliced in right after it. This is also the
// order every consumer (editor list, public site, PDF) renders in, so a
// heading's children always appear together under it.
export function orderBlocksHierarchically(blocks) {
  const childrenByParent = new Map();
  for (const block of blocks) {
    const key = block.parentId ?? null;
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(block);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((a, b) => a.position - b.position);
  }
  const ordered = [];
  const visited = new Set();
  function visit(parentId) {
    for (const block of childrenByParent.get(parentId) || []) {
      // A heading can never get a parentId through the API (assertValidParent
      // rejects it), so a cycle can only exist via direct SQLite edits — but
      // if it does, without this guard two headings pointing at each other
      // would recurse forever. Skipping an already-visited block breaks the
      // cycle instead of stack-overflowing every render/publish/PDF call.
      if (visited.has(block.id)) continue;
      ordered.push(block);
      visited.add(block.id);
      if (block.type === 'heading') visit(block.id);
    }
  }
  visit(null);
  // A block whose parentId doesn't resolve to anything in this set (a stale
  // reference — e.g. hand-edited SQLite) would otherwise vanish silently
  // instead of just failing to appear where expected. Surface it rather
  // than lose it.
  for (const block of blocks) {
    if (!visited.has(block.id)) ordered.push(block);
  }
  return ordered;
}
