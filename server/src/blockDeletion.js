// Given the existing hierarchical display order, promote a deleted block's
// children at that same location. Other sections keep their child positions.
export function promotedBlockPositions(orderedBlocks, deletedId) {
  return orderedBlocks
    .filter((block) => block.id !== deletedId && (block.parentId == null || block.parentId === deletedId))
    .map((block, position) => ({ id: block.id, position }));
}
