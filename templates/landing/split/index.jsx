// Split (issue #93): the hero (photo, availability, headline, buttons) in
// a left column that stays in view, the sections on the right. Styled by
// style.css; on a narrow page the two stack.
export default function SplitLanding({ landing, renderHero, renderSection }) {
  return (
    <main className="l-split">
      <div className="l-split-side">
        <div className="l-split-sticky">{renderHero()}</div>
      </div>
      <div className="l-split-content">
        <div className="l-main">{landing.sections.map(renderSection)}</div>
      </div>
    </main>
  );
}
