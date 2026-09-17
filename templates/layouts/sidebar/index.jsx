import { groupBlocksIntoColumns } from '@resume/blockColumns.js';
import { classifySkillsEducationAuto, sidebarTextStyle } from '@resume/sidebarPanel.js';
import './style.css';

export default function SidebarLayout({ blocks, renderBlock, colors }) {
  const { primary: main, secondary: sidebar } = groupBlocksIntoColumns(blocks, classifySkillsEducationAuto);

  return (
    <div className="r-body r-body-sidebar">
      <div className="r-sidebar" style={sidebarTextStyle(colors)}>
        {sidebar.map(renderBlock)}
      </div>
      <div className="r-main">{main.map(renderBlock)}</div>
    </div>
  );
}
