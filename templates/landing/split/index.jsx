// Split (issue #93): the hero (photo, availability, headline, buttons) in
// a left column, the sections on the right. A section set to the side
// column (`column: 'side'`, template.json's `columns`) goes in the left
// one, under the hero, in the page's order. The left column stays in view
// while the right one scrolls, unless it shows sections: then it may be
// taller than the window, and scrolls with the page. Styled by style.css;
// on a narrow page the two stack, the left one first.
export default function SplitLanding({ landing, renderHero, renderSection }) {
  const side = trimDividers(landing.sections.filter((section) => section.column === 'side'), { atStart: false });
  const main = trimDividers(landing.sections.filter((section) => section.column !== 'side'), { atStart: true });
  // A hidden section (only in the editor's preview) isn't on the page.
  const sideShown = side.some((section) => !section.hidden);
  return (
    <main className="l-split">
      <div className="l-split-side">
        <div className={`l-split-panel${sideShown ? '' : ' l-split-sticky'}`}>
          {renderHero()}
          {side.length > 0 && <div className="l-split-side-sections">{side.map(renderSection)}</div>}
        </div>
      </div>
      <div className="l-split-content">
        <div className="l-main">{main.map(renderSection)}</div>
      </div>
    </main>
  );
}

// The page's sections already have no stray divider (resolveLanding()'s
// dropStrayDividers()), but splitting them can leave one at a column's
// end, or at the top of the right one, which has no hero above it to
// divide from. Hidden sections (the editor's preview) don't count.
function trimDividers(sections, { atStart }) {
  const shown = sections.filter((section) => !section.hidden);
  const first = shown.findIndex((section) => section.kind !== 'divider');
  const last = shown.findLastIndex((section) => section.kind !== 'divider');
  const stray = new Set(
    shown.filter((section, i) => section.kind === 'divider' && ((atStart && i < first) || first === -1 || i > last))
  );
  return sections.filter((section) => !stray.has(section));
}
