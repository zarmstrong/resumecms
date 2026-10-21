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
  { value: 'primary', label: 'Primary column' },
  { value: 'secondary', label: 'Secondary column' },
];

// blocks: the full ordered array a layout component already receives
// (orderBlocksHierarchically output — flat, with parentId set).
// classifyAuto(group, index): 'primary' | 'secondary'. Called for every
// group, including ones with an explicit `data.column` override, so a
// stateful classifier (e.g. split-columns' alternating column) still sees
// every heading and advances consistently — its result is only used for
// groups that have no override.
//
// Most existing resumes predate block nesting, so a heading and its body are
// still separate top-level blocks with no parentId linking them. For a
// heading with *no* nested children, its group therefore also absorbs the
// unnested top-level blocks that immediately follow it, up to the next
// heading — the same adjacency a resume authored before nesting existed
// already implied. A heading that does have nested children is treated as
// authored with nesting in mind: a top-level block placed after it was
// deliberately dropped "after the whole section" in the editor (see
// blockDrag.js), so it starts its own headless group instead of being folded
// in. Consecutive headless blocks share one group.
//
// A block whose parentId points at a heading that isn't in `blocks` (its
// heading was filtered out by visibility in public.js, or stale hand-edited
// data) still needs to render, and in place — exactly where the flat array
// already has it — so it's treated like an unnested top-level block.
export function groupBlocksIntoColumns(blocks, classifyAuto) {
  const topLevelHeadingIds = new Set();
  for (const block of blocks) {
    if (block.parentId == null && block.type === 'heading') topLevelHeadingIds.add(block.id);
  }
  const childrenByParent = new Map();
  for (const block of blocks) {
    if (block.parentId == null || !topLevelHeadingIds.has(block.parentId)) continue;
    if (!childrenByParent.has(block.parentId)) childrenByParent.set(block.parentId, []);
    childrenByParent.get(block.parentId).push(block);
  }

  const groups = [];
  let current = null;
  let currentAbsorbsFollowing = false;
  for (const block of blocks) {
    // Nested under a heading that's present: already folded into its group.
    if (block.parentId != null && topLevelHeadingIds.has(block.parentId)) continue;
    if (block.type === 'heading') {
      const children = childrenByParent.get(block.id) || [];
      current = { heading: block, blocks: [block, ...children] };
      currentAbsorbsFollowing = children.length === 0;
      groups.push(current);
    } else if (current && currentAbsorbsFollowing) {
      current.blocks.push(block);
    } else {
      current = { heading: null, blocks: [block] };
      currentAbsorbsFollowing = true;
      groups.push(current);
    }
  }

  const primary = [];
  const secondary = [];
  groups.forEach((group, index) => {
    const auto = classifyAuto(group, index);
    const override = group.heading?.data?.column;
    const column = override === 'primary' || override === 'secondary' ? override : auto;
    (column === 'secondary' ? secondary : primary).push(...group.blocks);
  });
  return { primary, secondary };
}

// classifyAuto factory for layouts that alternate sections between two
// equal columns (split-columns). Stateful on purpose: the column only
// advances when a *heading* group comes along, so headless groups — a
// summary before the first heading, or a top-level block dropped after a
// nested section — don't consume a column slot and instead stay in the
// column of whatever section precedes them. Create a fresh one per render.
export function makeAlternateByHeadingClassifier() {
  let column = 'primary';
  let seenHeading = false;
  return (group) => {
    if (group.heading) {
      if (seenHeading) column = column === 'primary' ? 'secondary' : 'primary';
      seenHeading = true;
    }
    return column;
  };
}
