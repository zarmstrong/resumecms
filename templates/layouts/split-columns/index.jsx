import { groupBlocksIntoColumns, makeAlternateByHeadingClassifier } from '@resume/blockColumns.js';
import './style.css';

// Unlike "sidebar"/"sidebar-right", there's no skills/education heuristic
// here — sections alternate between the two equal-width columns by default
// (left, right, left, ...), fully overridable per heading via its own
// `data.column`. The classifier only advances on heading groups, so a
// headless group (summary before the first heading, or a block placed after
// a nested section) rides along in the column the previous section landed
// in, pin included — see makeAlternateByHeadingClassifier in blockColumns.js.
//
// Each block gets its index in the authored order as a flex `order`. On
// wide viewports the two column divs are grid cells and the order is inert;
// below the breakpoint style.css flattens the columns with `display:
// contents` and stacks everything, so phone readers get sections in the
// order they were authored rather than "all left, then all right".
export default function SplitColumnsLayout({ blocks, renderBlock }) {
  const { primary: left, secondary: right } = groupBlocksIntoColumns(
    blocks,
    makeAlternateByHeadingClassifier(),
  );
  const orderById = new Map(blocks.map((block, index) => [block.id, index]));
  const renderOrdered = (block) => renderBlock(block, { style: { order: orderById.get(block.id) } });

  return (
    <div className="r-body r-body-split-columns">
      <div className="r-split-column">{left.map(renderOrdered)}</div>
      <div className="r-split-column">{right.map(renderOrdered)}</div>
    </div>
  );
}
