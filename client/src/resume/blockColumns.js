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
export function groupBlocksIntoColumns(blocks, classifyAuto) {
  const childrenByParent = new Map();
  for (const block of blocks) {
    if (block.parentId == null) continue;
    if (!childrenByParent.has(block.parentId)) childrenByParent.set(block.parentId, []);
    childrenByParent.get(block.parentId).push(block);
  }

  const groups = [];
  for (const block of blocks) {
    if (block.parentId != null) continue; // belongs to its heading's group, handled below
    if (block.type === 'heading') {
      groups.push({ heading: block, blocks: [block, ...(childrenByParent.get(block.id) || [])] });
    } else {
      groups.push({ heading: null, blocks: [block] });
    }
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
