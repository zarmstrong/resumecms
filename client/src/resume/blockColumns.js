// Shared grouping logic for layouts that split the body into two columns
// (see templates/layouts/sidebar, sidebar-right, split-columns). A "group"
// is a top-level block plus, if it's a heading, every block nested under it
// via parentId — the unit that moves together between columns.
//
// Column placement in `data.column` is layout-agnostic: it lives on the
// heading block itself, not on any one layout, so switching between e.g.
// "sidebar" and "split-columns" carries a user's explicit choices over.
export const HEADING_COLUMN_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'primary', label: 'Column 1' },
  { value: 'secondary', label: 'Column 2' },
];

// blocks: the full ordered array a layout component already receives
// (orderBlocksHierarchically output — flat, with parentId set).
// classifyAuto(group, index): 'primary' | 'secondary', called only when the
// group's heading has no explicit override (or the group has no heading).
//
// Most existing resumes predate block nesting, so a heading and its body are
// still separate top-level blocks with no parentId linking them. A group is
// therefore a heading plus both its explicitly nested children (parentId)
// *and* whatever unnested top-level blocks immediately follow it, up to the
// next heading — the same adjacency a resume authored before nesting existed
// already implied. A block whose parentId points at a heading that isn't a
// top-level block here (stale/orphaned, e.g. hand-edited data) still needs
// to render somewhere, so it becomes its own group instead of being dropped
// — mirrors the server's orderBlocksHierarchically().
export function groupBlocksIntoColumns(blocks, classifyAuto) {
  const childrenByParent = new Map();
  for (const block of blocks) {
    if (block.parentId == null) continue;
    if (!childrenByParent.has(block.parentId)) childrenByParent.set(block.parentId, []);
    childrenByParent.get(block.parentId).push(block);
  }

  const consumedParentIds = new Set();
  const groups = [];
  let current = null;
  for (const block of blocks) {
    if (block.parentId != null) continue; // folded into its heading's group above, or an orphan handled below
    if (block.type === 'heading') {
      const children = childrenByParent.get(block.id) || [];
      consumedParentIds.add(block.id);
      current = { heading: block, blocks: [block, ...children] };
      groups.push(current);
    } else if (current) {
      current.blocks.push(block);
    } else {
      current = { heading: null, blocks: [block] };
      groups.push(current);
    }
  }

  for (const [parentId, children] of childrenByParent) {
    if (consumedParentIds.has(parentId)) continue;
    for (const child of children) groups.push({ heading: null, blocks: [child] });
  }

  const primary = [];
  const secondary = [];
  groups.forEach((group, index) => {
    const override = group.heading?.data?.column;
    const column =
      override === 'primary' || override === 'secondary' ? override : classifyAuto(group, index);
    (column === 'secondary' ? secondary : primary).push(...group.blocks);
  });
  return { primary, secondary };
}
