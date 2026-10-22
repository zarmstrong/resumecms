import { groupBlocksIntoColumns } from '@resume/blockColumns.js';
import { classifySkillsEducationAuto, sidebarTextStyle } from '@resume/sidebarPanel.js';
import '@resume/sidebarPanel.css';
import './style.css';

// Mirrors "sidebar" — same grouping heuristic and rail styling (shared via
// @resume/sidebarPanel.js) — just with the tinted rail on the right instead
// of the left.
export default function SidebarRightLayout({ blocks, renderBlock, colors }) {
  const { primary: main, secondary: sidebar } = groupBlocksIntoColumns(blocks, classifySkillsEducationAuto);

  return (
    <div className="r-body r-body-sidebar-right">
      <div className="r-main">{main.map(renderBlock)}</div>
      <div className="r-sidebar" style={sidebarTextStyle(colors)}>
        {sidebar.map(renderBlock)}
      </div>
    </div>
  );
}
