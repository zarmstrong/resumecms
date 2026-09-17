import { groupBlocksIntoColumns } from '@resume/blockColumns.js';
import './style.css';

// Unlike "sidebar"/"sidebar-right", there's no skills/education heuristic
// here — sections alternate between the two equal-width columns by default
// (left, right, left, ...), fully overridable per heading via its own
// `data.column` (see blockColumns.js).
//
// Most existing resumes predate block nesting, so a heading and its body
// (e.g. an experience entry) are still separate top-level blocks with no
// parentId linking them — not just nested groups. Alternating on every
// *group* would then flip column on every block, splitting every heading
// from its own content. Instead this only advances to the next column when
// it sees another heading, so an unnested heading and whatever follows it
// still land together by default.
function makeClassifyAuto() {
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

export default function SplitColumnsLayout({ blocks, renderBlock }) {
  const { primary: left, secondary: right } = groupBlocksIntoColumns(blocks, makeClassifyAuto());

  return (
    <div className="r-body r-body-split-columns">
      <div className="r-split-column">{left.map(renderBlock)}</div>
      <div className="r-split-column">{right.map(renderBlock)}</div>
    </div>
  );
}
