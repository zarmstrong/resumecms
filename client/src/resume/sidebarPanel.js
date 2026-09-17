import { contrastTextFor } from './siteColors.js';

// Shared by the "sidebar" and "sidebar-right" layouts — same auto-placement
// heuristic and same rail text-contrast handling; only which side the rail
// renders on differs between the two.
const SIDEBAR_AUTO_TYPES = new Set(['skills_group', 'education']);

// A heading's section goes to the rail (the "secondary" column, see
// blockColumns.js) when every block nested under it is one of these types;
// everything else stays in the main ("primary") column. A heading can
// override this via its own `data.column`.
export function classifySkillsEducationAuto(group) {
  const items = group.blocks.filter((b) => b.type !== 'heading');
  return items.length > 0 && items.every((b) => SIDEBAR_AUTO_TYPES.has(b.type)) ? 'secondary' : 'primary';
}

// A custom sidebar background can be dark; without this the rail's
// heading/body text (which default to near-black) would go illegible.
export function sidebarTextStyle(colors) {
  if (!colors.sidebarBackground) return undefined;
  const text = contrastTextFor(colors.sidebarBackground);
  return { color: text, '--r-heading': text, '--slate': text, '--slate-light': text };
}
