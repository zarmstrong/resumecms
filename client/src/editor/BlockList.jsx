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
// Reordering re-derives every block's parentId from its new position in the
// flat list: dragging a block to sit right after a heading (and before the
// next heading or top-level block) nests it there; dragging it anywhere
// else un-nests it. Headings always reset to top-level regardless of where
// they're dropped, which is what keeps nesting to one level.
function reparentByPosition(orderedBlocks) {
  let currentHeadingId = null;
  return orderedBlocks.map((block) => {
    if (block.type === 'heading') {
      currentHeadingId = block.id;
      return block.parentId == null ? block : { ...block, parentId: null };
    }
    const parentId = NESTABLE_TYPES.has(block.type) ? currentHeadingId : null;
    return block.parentId === parentId ? block : { ...block, parentId };
  });
}

export function BlockList({ blocks, onReorder, onChangeData, onChangeVisibility, onDelete }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    const reordered = reparentByPosition(arrayMove(blocks, oldIndex, newIndex));
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
              nested={!!block.parentId}
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
