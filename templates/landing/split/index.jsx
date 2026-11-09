// Split (issue #93): the hero (photo, availability, headline, buttons) in
// a left column, the sections on the right. A section set to the side
// column (`column: 'side'`, template.json's `columns`) goes in the left
// one, under the hero, in the page's order. The left column stays in view
// while the right one scrolls, unless it holds sections: then it may be
// taller than the window, and scrolls with the page. Styled by style.css;
// on a narrow page the two stack, the left one first.
export default function SplitLanding({ landing, renderHero, renderSection }) {
  const side = landing.sections.filter((section) => section.column === 'side');
  const main = landing.sections.filter((section) => section.column !== 'side');
  return (
    <main className="l-split">
      <div className="l-split-side">
        <div className={`l-split-panel${side.length ? '' : ' l-split-sticky'}`}>
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
