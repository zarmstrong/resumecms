// Cover (issue #130): the page's cover image (`coverImage`, which only a
// template whose template.json says `cover: true` draws) across the full
// width, the hero (photo, availability, headline, buttons) over it behind
// a scrim, and the sections below in one column. Without a cover image the
// hero sits on a band of the heading color instead. Styled by style.css:
// .l-cover > .l-cover-band(.l-cover-photo | .l-cover-plain) >
// .l-cover-image and .l-cover-hero > .l-hero, then .l-main > the sections.
// The image comes first, so a description (when it has one) is read before
// the name; a blank one makes it decoration (alt="").
export default function CoverLanding({ landing, renderHero, renderSection }) {
  const cover = landing.coverImage;
  return (
    <main className="l-cover">
      <div className={`l-cover-band ${cover ? 'l-cover-photo' : 'l-cover-plain'}`}>
        {cover && <img className="l-cover-image" src={cover.src} alt={cover.alt} width={cover.width} height={cover.height} />}
        <div className="l-cover-hero">{renderHero()}</div>
      </div>
      <div className="l-main">{landing.sections.map(renderSection)}</div>
    </main>
  );
}
