// Split (issue #93): the hero (photo, availability, headline, buttons) in
// a left column, the sections on the right. A section set to the side
// column (`column: 'side'`, template.json's `columns`) goes in the left
// one, under the hero, in the page's order. The left column stays in view
// while the right one scrolls, unless it shows sections: then it may be
// taller than the window, and scrolls with the page. Styled by style.css;
// on a narrow page the two stack, the left one first. Each column draws
// only the dividers it has something to divide in (dropStrayDividers(),
// from LandingView): the left one may start with one, under the hero.
export default function SplitLanding({ landing, renderHero, renderSection, dropStrayDividers }) {
  const side = dropStrayDividers(landing.sections.filter((section) => section.column === 'side'), { atStart: true });
  const main = dropStrayDividers(landing.sections.filter((section) => section.column !== 'side'), { atStart: false });
  // A hidden or stray section (only in the editor's preview) isn't on the page.
  const sideShown = side.some((section) => !section.hidden && !section.stray);
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
