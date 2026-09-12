import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableBlockRow } from './SortableBlockRow.jsx';

export function BlockList({ blocks, onReorder, onChangeData, onChangeVisibility, onDelete }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = blocks.findIndex((b) => b.id === active.id);
    const newIndex = blocks.findIndex((b) => b.id === over.id);
    const reordered = arrayMove(blocks, oldIndex, newIndex);
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
