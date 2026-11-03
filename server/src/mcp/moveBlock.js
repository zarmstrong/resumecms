// Turns a "move this one block" request into the full-order `items` list
// that the store's reorderBlocks() requires, so an MCP agent doesn't have
// to reproduce the whole ordering (and its contiguity rules) by hand.
//
// `orderedBlocks` is the current display order (listBlocks()). The moved
// block — together with its children, if it's a heading — is lifted out and
// reinserted at the target:
//   parentId: undefined keeps the current parent, null promotes to top
//             level, a heading id nests (the store validates the type).
//   beforeId / afterId: place relative to a sibling in the target group.
//   index: 0-based position within the target group.
// With none of the three, the block goes to the end of the target group.
// Returns [{ id, parentId }] in display order; sections stay contiguous.
//
// The input is trusted to be consistent (every child's parentId names a
// heading in the list), which listBlocks() guarantees; if it somehow isn't,
// the output is incomplete and the store's reorderBlocks() rejects it with
// a 400 rather than this helper papering over it.

import { httpError } from '../httpError.js';

export function moveBlockOrder(orderedBlocks, { id, parentId, beforeId, afterId, index } = {}) {
  const moving = orderedBlocks.find((b) => b.id === id);
  if (!moving) throw httpError(404, 'Block not found');

  const anchors = [beforeId, afterId, index].filter((v) => v !== undefined && v !== null).length;
  if (anchors > 1) throw httpError(400, 'Specify at most one of beforeId, afterId, or index');

  const targetParent = parentId === undefined ? (moving.parentId ?? null) : parentId;
  if (targetParent === id) throw httpError(400, 'A block cannot be nested under itself');
  if (targetParent != null && moving.type === 'heading') {
    throw httpError(400, "heading blocks can't be nested under a heading");
  }

  // Lift only the moved block out of its sibling group. A moved heading's
  // children stay in childrenOf under its id, so they travel with it (as
  // the editor's drag-and-drop does) wherever the heading is reinserted.
  const remaining = orderedBlocks.filter((b) => b.id !== id);
  const topLevel = remaining.filter((b) => (b.parentId ?? null) === null);
  const childrenOf = new Map();
  for (const b of remaining) {
    const key = b.parentId ?? null;
    if (key === null) continue;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key).push(b);
  }

  // Resolve the insertion index within the target group.
  function resolveIndex(group) {
    if (beforeId != null || afterId != null) {
      const anchorId = beforeId != null ? beforeId : afterId;
      if (anchorId === id) throw httpError(400, 'A block cannot be placed relative to itself');
      const at = group.findIndex((b) => b.id === anchorId);
      if (at === -1) {
        throw httpError(400, `${anchorId} is not a sibling in the target group (parentId ${targetParent ?? 'null'})`);
      }
      return beforeId != null ? at : at + 1;
    }
    if (index != null) {
      if (!Number.isInteger(index) || index < 0) throw httpError(400, 'index must be a non-negative integer');
      return Math.min(index, group.length);
    }
    return group.length;
  }

  if (targetParent === null) {
    const at = resolveIndex(topLevel);
    topLevel.splice(at, 0, { ...moving, parentId: null });
  } else {
    if (!remaining.some((b) => b.id === targetParent)) {
      throw httpError(400, 'parentId does not reference an existing block');
    }
    if (!childrenOf.has(targetParent)) childrenOf.set(targetParent, []);
    const group = childrenOf.get(targetParent);
    const at = resolveIndex(group);
    group.splice(at, 0, { ...moving, parentId: targetParent });
  }

  // Flatten back to display order: each top-level block, then its children.
  const items = [];
  for (const top of topLevel) {
    items.push({ id: top.id, parentId: null });
    for (const child of childrenOf.get(top.id) || []) {
      items.push({ id: child.id, parentId: top.id });
    }
  }
  return items;
}
