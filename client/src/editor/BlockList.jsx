import { DndContext, DragOverlay, PointerSensor, useDndContext, useSensor, useSensors } from '@dnd-kit/core';
import { SortableBlockRow } from './SortableBlockRow.jsx';
import { BLOCK_TYPE_LABELS, NESTABLE_TYPES } from './blockDefaults.js';
import { pointerPlacement, projectBlockDrop } from './blockDrag.js';

function BlockRows({ blocks, ...callbacks }) {
  const { active, collisions } = useDndContext();
  const drop = collisions?.[0]?.data?.projection;
  const headingIds = new Set(blocks.filter((b) => b.type === 'heading' && b.parentId == null).map((b) => b.id));
  const dragged = blocks.find((b) => b.id === active?.id);
  return (
    <>
      <p className="ed-drag-help">Drag onto a heading to nest. Drag to the left edge to move out of a section.</p>
      <div className="ed-block-list">
        {blocks.map((block) => (
          <SortableBlockRow
            key={block.id}
            block={block}
            nested={headingIds.has(block.parentId)}
            drop={drop?.headingId === block.id || (!drop?.headingId && drop?.anchorId === block.id) ? drop : null}
            nestTarget={!!dragged && NESTABLE_TYPES.has(dragged.type) && headingIds.has(block.id)}
            moving={dragged?.type === 'heading' && block.parentId === dragged.id}
            {...callbacks}
          />
        ))}
      </div>
      <div className="ed-sr-only" role="status" aria-live="polite">{drop?.label || ''}</div>
      {/* Keep the preview below the destination indicator (z-index: 5). */}
      <DragOverlay dropAnimation={null} zIndex={4}>
        {dragged ? <div className="ed-drag-preview">{BLOCK_TYPE_LABELS[dragged.type]}{dragged.type === 'heading' ? `: ${dragged.data?.text || 'Untitled section'}` : ''}</div> : null}
      </DragOverlay>
    </>
  );
}

export function BlockList({ blocks, onReorder, ...callbacks }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function collisionDetection({ active, pointerCoordinates, droppableRects, droppableContainers }) {
    if (!pointerCoordinates) return [];
    const moved = blocks.find((b) => b.id === active.id);
    if (!moved) return [];
    // Stationary targets and pointer geometry avoid the direction-dependent
    // arrayMove behavior and target jumps caused by shifting sortable rows.
    for (const container of droppableContainers) {
      const rect = droppableRects.get(container.id);
      const node = container.node.current;
      const listRect = node?.parentElement?.getBoundingClientRect();
      if (!rect || !listRect) continue;
      const { x, y } = pointerCoordinates;
      if (x < listRect.left || x > listRect.right || y < rect.top || y > rect.bottom) continue;
      const over = blocks.find((b) => b.id === container.id);
      // Editing forms must not move the heading's nesting target away from
      // its title. Keep the full row as a hit area, but measure its header.
      const placementRect = over.type === 'heading'
        ? node.querySelector('.ed-block-row-header')?.getBoundingClientRect() ?? rect
        : rect;
      let placement = pointerPlacement(over, placementRect, pointerCoordinates);
      // A heading's center is always a nesting target, including when
      // dragging straight down by a top-level row's left-hand grip.
      const topLevel = over.type !== 'heading' && x < listRect.left + 22;
      if (placement === 'inside' && (!NESTABLE_TYPES.has(moved.type) || topLevel)) {
        placement = y < placementRect.top + placementRect.height / 2 ? 'before' : 'after';
      }
      const projection = projectBlockDrop(blocks, active.id, container.id, placement, topLevel);
      return projection ? [{ id: container.id, data: { projection } }] : [];
    }
    return [];
  }

  function handleDragEnd({ collisions }) {
    const reordered = collisions?.[0]?.data?.projection?.ordered;
    if (!reordered || reordered.every((b, i) => b.id === blocks[i].id && (b.parentId ?? null) === (blocks[i].parentId ?? null))) return;
    onReorder(reordered);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragEnd={handleDragEnd}>
      <BlockRows blocks={blocks} {...callbacks} />
    </DndContext>
  );
}
