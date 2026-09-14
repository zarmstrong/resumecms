import { contrastTextFor } from '@resume/siteColors.js';
import './style.css';

// A heading and the blocks under it move to the side rail when every block
// in that section is one of these types; everything else (experience,
// custom, and any heading with no body yet) stays in the main column.
const SIDEBAR_BLOCK_TYPES = new Set(['skills_group', 'education']);

function splitBlocksForSidebar(blocks) {
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

export default function SidebarLayout({ blocks, renderBlock, colors }) {
  const { sidebar, main } = splitBlocksForSidebar(blocks);

  // A custom sidebar background can be dark; without this the sidebar's
  // heading/body text (which default to near-black) would go illegible.
  let sidebarTextStyle;
  if (colors.sidebarBackground) {
    const sidebarText = contrastTextFor(colors.sidebarBackground);
    sidebarTextStyle = { color: sidebarText, '--r-heading': sidebarText, '--slate': sidebarText, '--slate-light': sidebarText };
  }

  return (
    <div className="r-body r-body-sidebar">
      <div className="r-sidebar" style={sidebarTextStyle}>
        {sidebar.map(renderBlock)}
      </div>
      <div className="r-main">{main.map(renderBlock)}</div>
    </div>
  );
}
