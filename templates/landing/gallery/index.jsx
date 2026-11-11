// Gallery (issue #130): the hero, then the sections in an .l-main like a
// template without a component, except that a run of image sections one
// after another is drawn as one block of pictures side by side (an
// .l-run), each as wide as its shape asks for, so the pictures in a row
// share one height and none is cropped (style.css). That needs each
// image's width and height, which only the resolved page knows, hence this
// component: it puts each one's shape on its wrapper as --l-run-ratio. A
// divider, or any other section, ends a run. An image section the editor's
// preview shows dimmed as hidden stays in its run; any other hidden one
// ends it there, although the page, without it, may join the two runs.
export default function GalleryLanding({ landing, renderHero, renderSection }) {
  const parts = [];
  let run = [];
  const endRun = () => {
    if (run.length === 1) parts.push(renderSection(run[0].section, run[0].index));
    if (run.length > 1) {
      parts.push(
        <div key={`run-${run[0].section.id ?? run[0].index}`} className="l-run">
          {run.map(({ section, index }) => (
            <div key={section.id ?? index} className="l-run-item" style={{ '--l-run-ratio': ratioOf(section.image) }}>
              {renderSection(section, index)}
            </div>
          ))}
        </div>,
      );
    }
    run = [];
  };
  landing.sections.forEach((section, index) => {
    if (section.kind === 'image' && section.image) {
      run.push({ section, index });
    } else {
      endRun();
      parts.push(renderSection(section, index));
    }
  });
  endRun();
  return (
    <main className="l-main">
      {renderHero()}
      {parts}
    </main>
  );
}

// Width over height, kept to a sane range so a panorama or a sliver can't
// take a whole row or vanish in one.
function ratioOf(image) {
  const ratio = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  return Math.min(4, Math.max(0.25, ratio)).toFixed(4);
}
