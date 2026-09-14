// Body layouts are a separate axis from header templates (see templates.js)
// — they only affect how section blocks are arranged/styled below the
// header, so a header style and a body layout can be mixed freely.
export const LAYOUT_OPTIONS = [
  { value: 'classic', label: 'Classic' },
  { value: 'sidebar', label: 'Sidebar' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'minimal', label: 'Minimal / ATS-friendly' },
  { value: 'boxed', label: 'Boxed cards' },
];

export const DEFAULT_LAYOUT = 'classic';

export function normalizeLayout(site) {
  const value = site?.layout;
  return LAYOUT_OPTIONS.some((l) => l.value === value) ? value : DEFAULT_LAYOUT;
}

// Each body layout picks its own default presentation for skills_group
// blocks, the same way "sidebar" already stacks them and "minimal" already
// strips their pill styling in CSS — "boxed" pairs naturally with each
// skill rendered as its own small chip rather than one label + a comma
// list. Layouts not listed here fall back to 'rows' (today's default).
const SKILLS_DISPLAY_BY_LAYOUT = {
  boxed: 'chips',
};

export function skillsDisplayFor(site) {
  return SKILLS_DISPLAY_BY_LAYOUT[normalizeLayout(site)] || 'rows';
}

// "sidebar" layout only: a heading and the blocks under it move to the
// narrow side rail when every block in that section is one of these types;
// everything else (experience, custom, and any heading with no body yet)
// stays in the main column.
const SIDEBAR_BLOCK_TYPES = new Set(['skills_group', 'education']);

export function splitBlocksForSidebar(blocks) {
  const groups = [];
  let current = null;
  for (const block of blocks) {
    if (block.type === 'heading') {
      current = { heading: block, items: [] };
      groups.push(current);
    } else if (current) {
      current.items.push(block);
    } else {
      current = { heading: null, items: [block] };
      groups.push(current);
    }
  }

  const sidebar = [];
  const main = [];
  for (const group of groups) {
    const target =
      group.items.length > 0 && group.items.every((b) => SIDEBAR_BLOCK_TYPES.has(b.type))
        ? sidebar
        : main;
    if (group.heading) target.push(group.heading);
    target.push(...group.items);
  }
  return { sidebar, main };
}
