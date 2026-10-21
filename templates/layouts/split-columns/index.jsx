import { groupBlocksIntoColumns, makeAlternateByHeadingClassifier } from '@resume/blockColumns.js';
import './style.css';

// Unlike "sidebar"/"sidebar-right", there's no skills/education heuristic
// here — sections alternate between the two equal-width columns by default
// (left, right, left, ...), fully overridable per heading via its own
// `data.column`. The classifier only advances on heading groups, so a
// headless group (summary before the first heading, or a block placed after
// a nested section) rides along in the current column rather than taking a
// slot of its own — see makeAlternateByHeadingClassifier in blockColumns.js.
export default function SplitColumnsLayout({ blocks, renderBlock }) {
  const { primary: left, secondary: right } = groupBlocksIntoColumns(
    blocks,
    makeAlternateByHeadingClassifier(),
  );

  return (
    <div className="r-body r-body-split-columns">
      <div className="r-split-column">{left.map(renderBlock)}</div>
      <div className="r-split-column">{right.map(renderBlock)}</div>
    </div>
  );
}
