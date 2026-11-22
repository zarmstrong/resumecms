import {
  faA,
  faB,
  faC,
  faD,
  faE,
  faF,
  faG,
  faH,
  faI,
  faJ,
  faK,
  faL,
  faM,
  faN,
  faO,
  faP,
  faQ,
  faR,
  faS,
  faT,
  faU,
  faV,
  faW,
  faX,
  faY,
  faZ,
} from '@fortawesome/free-solid-svg-icons';

// A contact link's type letter (`linkGlyph()` in linkTypes.js), drawn as
// a Font Awesome Free letter icon (icons CC BY 4.0, code MIT; the build
// keeps the packages' license comments, the attribution that asks for)
// rather than as text. As text, the letter went into a PDF's text layer,
// often out of place: a parser read the LinkedIn badge as a stray "I" at
// the end of the resume (issue #222). A path looks the same and isn't text.
// Decorative, so aria-hidden: the link's label says what it is.
const LETTERS = {
  a: faA,
  b: faB,
  c: faC,
  d: faD,
  e: faE,
  f: faF,
  g: faG,
  h: faH,
  i: faI,
  j: faJ,
  k: faK,
  l: faL,
  m: faM,
  n: faN,
  o: faO,
  p: faP,
  q: faQ,
  r: faR,
  s: faS,
  t: faT,
  u: faU,
  v: faV,
  w: faW,
  x: faX,
  y: faY,
  z: faZ,
};

export function LinkGlyph({ glyph, className = 'r-link-glyph' }) {
  const entry = LETTERS[String(glyph || '').toLowerCase()];
  if (!entry) return null;
  const [width, height, , , path] = entry.icon;
  return (
    <svg className={className} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <path d={path} fill="currentColor" />
    </svg>
  );
}

// The square badge most headers and the landing page's links section put
// before a link.
export function LinkBadge({ glyph }) {
  return (
    <span className="r-link-badge" aria-hidden="true">
      <LinkGlyph glyph={glyph} />
    </span>
  );
}
