import { NESTABLE_TYPES } from './blockDefaults.js';

// Resolve a pointer target into a legal position in the one-level tree. Both
// the indicator and the saved order use this projection, including section moves.
export function projectBlockDrop(blocks, activeId, overId, placement, topLevel = false) {
  const moved = blocks.find((b) => b.id === activeId);
  const over = blocks.find((b) => b.id === overId);
  if (!moved || !over) return null;
  const headings = new Map(blocks.filter((b) => b.type === 'heading' && b.parentId == null).map((b) => [b.id, b]));
  const group = blocks.filter((b) => b.id === activeId || (moved.type === 'heading' && b.parentId === activeId));
  if (overId !== activeId && group.includes(over)) return null;
  const remaining = blocks.filter((b) => !group.includes(b));
  let parentId = null;
  let anchor = over;
  if (NESTABLE_TYPES.has(moved.type) && !topLevel) {
    if (placement === 'inside' && headings.has(overId)) parentId = overId;
    else if (headings.has(over.parentId)) parentId = over.parentId;
  }
  if (placement === 'inside' && parentId !== overId) return null;
  let index;
  if (parentId === overId) {
    // Dropping on a heading inserts at the start of the section from either direction.
    index = remaining.findIndex((b) => b.id === overId) + 1;
  } else {
    if (!parentId && headings.has(over.parentId)) anchor = headings.get(over.parentId);
    index = remaining.findIndex((b) => b.id === anchor.id);
    if (index === -1) {
      // A horizontal drag can change parent without changing the row's position.
      index = blocks.slice(0, blocks.indexOf(over)).filter((b) => remaining.includes(b)).length;
    } else if (placement === 'after') {
      index += 1;
      if (!parentId && anchor.type === 'heading') {
        while (remaining[index]?.parentId === anchor.id) index += 1;
      }
    }
  }
  const updated = group.map((b) => b.id === activeId ? { ...b, parentId } : b);
  const ordered = [...remaining.slice(0, index), ...updated, ...remaining.slice(index)];
  const next = remaining[index];
  const previous = remaining[index - 1];
  return {
    ordered, parentId,
    headingId: placement === 'inside' ? overId : null,
    anchorId: next?.id ?? previous?.id,
    edge: next ? 'before' : 'after',
    label: parentId ? `Nest under “${headings.get(parentId).data?.text || 'Untitled section'}”` : 'Move to top level',
  };
}

export function pointerPlacement(block, rect, pointer) {
  const fraction = (pointer.y - rect.top) / rect.height;
  if (block.type === 'heading' && fraction >= 0.25 && fraction <= 0.75) return 'inside';
  return fraction < 0.5 ? 'before' : 'after';
}
