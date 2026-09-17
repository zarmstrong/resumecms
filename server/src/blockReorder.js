// POST /blocks/reorder documents `items` as the full desired display order —
// a heading immediately followed by its children, never split by an
// unrelated block in between. orderBlocksHierarchically() would silently
// re-derive the correct order for a request that violates this, which is
// confusing for API consumers relying on the documented contract. Returns
// the id of the first block whose section isn't contiguous, or null if the
// order is valid.
export function findSplitSectionId(items) {
  let currentGroup = null;
  const finishedGroups = new Set();
  for (let i = 0; i < items.length; i++) {
    const { id, parentId } = items[i];
    const key = parentId ?? null;
    if (key === currentGroup) continue;
    if (key !== null) {
      if (finishedGroups.has(key)) return id;
      const prev = items[i - 1];
      if (!prev || prev.id !== key) return id;
    }
    if (currentGroup !== null) finishedGroups.add(currentGroup);
    currentGroup = key;
  }
  return null;
}
