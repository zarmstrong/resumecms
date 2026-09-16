import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableBlockRow } from './SortableBlockRow.jsx';
import { NESTABLE_TYPES } from './blockDefaults.js';

// The server always delivers `blocks` in hierarchical order — a heading
// immediately followed by its children (see orderBlocksHierarchically in
// server/src/db.js) — so that flat array doubles as the editor's display
// order and its drag-and-drop order: nothing to derive here.
//
// Only the block that was actually dragged ever has its parentId
// recomputed — every other block keeps whatever it already had, so moving
// one block can never silently re-nest or un-nest blocks the user didn't
// touch (and a nestable block that happens to sit right after a heading,
// without having been dragged there, stays top-level). The moved block
// nests under whichever heading — or joins whichever existing group — it
// now sits directly after; landing anywhere else un-nests it. Headings
// always reset to top-level regardless of where they're dropped, which is
// what keeps nesting to one level.
function reparentMovedBlock(orderedBlocks, movedId) {
  const index = orderedBlocks.findIndex((b) => b.id === movedId);
  if (index === -1) return orderedBlocks; // dragged block no longer exists (state changed mid-drag) — nothing to do
  const moved = orderedBlocks[index];

  // A candidate parent must be an actual top-level heading in the current
  // list — otherwise a stale/orphaned parentId sitting on the previous
  // block (see orderBlocksHierarchically's orphan handling) would get
  // copied onto the moved block too, and the server would then reject the
  // whole reorder request rather than just leaving one block mis-nested.
  const topLevelHeadingIds = new Set(
    orderedBlocks.filter((b) => b.type === 'heading' && b.parentId == null).map((b) => b.id)
  );

  let parentId = null;
  if (moved.type !== 'heading' && NESTABLE_TYPES.has(moved.type)) {
    const prev = orderedBlocks[index - 1];
    const candidate = prev?.type === 'heading' ? prev.id : (prev?.parentId ?? null);
    if (candidate != null && topLevelHeadingIds.has(candidate)) parentId = candidate;
  }

  if (moved.parentId === parentId) return orderedBlocks;
  return orderedBlocks.map((b) => (b.id === movedId ? { ...b, parentId } : b));
}

export function BlockList({ blocks, onReorder, onChangeData, onChangeVisibility, onDelete }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  // A block's parentId can point at a heading that's no longer in this list,
  // or (via corrupted/imported data) at a heading that isn't itself
  // top-level — a stale reference either way, since assertValidParent
  // server-side only ever allows nesting under a top-level heading (see
  // orderBlocksHierarchically's own handling of this in server/src/db.js).
  // Indenting it anyway would show it nested under a relationship the
  // server doesn't recognize, so only indent when the parent is an actual
  // top-level heading.
  const topLevelHeadingIds = new Set(
    blocks.filter((b) => b.type === 'heading' && b.parentId == null).map((b) => b.id)
  );

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    const reordered = reparentMovedBlock(arrayMove(blocks, oldIndex, newIndex), active.id);
    onReorder(reordered);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={blocks.map((b) => b.id)} strategy={verticalListSortingStrategy}>
        <div className="ed-block-list">
          {blocks.map((block) => (
            <SortableBlockRow
              key={block.id}
              block={block}
              nested={!!block.parentId && topLevelHeadingIds.has(block.parentId)}
              onChangeData={onChangeData}
              onChangeVisibility={onChangeVisibility}
              onDelete={onDelete}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
