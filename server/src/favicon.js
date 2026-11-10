import { createHash } from 'node:crypto';
import { escapeHtml } from './pageMeta.js';
import { DEFAULT_LANDING_COLORS } from './landingStyle.js';

// The site's icon (issue #104): the person's initials on the accent color,
// served as /favicon.svg and, rasterized by faviconRaster.js, as a 180×180
// /apple-touch-icon.png. Pure; routes/favicon.js asks the store what the
// host's `/` shows and hands this its published name and colors.
//
// The name and colors go into SVG markup, so everything in it passes
// through escapeHtml() (pageMeta.js's, the one place that escapes the
// shell's tags too) and a color is used only as #rrggbb. A page with no
// name (nothing published yet, or a header without one) gets the neutral
// mark: the same tile with three lines in place of the initials.

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
// How much of a name is looked at: enough for any real one, and a bound on
// the work a long one costs.
const NAME_MAX = 200;
// The icon's own coordinates; /apple-touch-icon.png is drawn from them at
// APPLE_TOUCH_SIZE.
const VIEW = 64;
export const APPLE_TOUCH_SIZE = 180;

// What the neutral mark is drawn in when there's no published page at all
// (or the store failed): a slate that suits any site.
export const NEUTRAL_COLORS = { accent: '#5b6670' };
// Fonts every platform has (Liberation Sans in the Docker image, for the
// PNG); a favicon is drawn as an image, so it never gets the page's web
// fonts.
const FONT_FAMILY = "'Liberation Sans', Arial, Helvetica, sans-serif";

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const STARTS_WORD = /^[\p{L}\p{N}]/u;

// Up to two initials: the first letter (or digit) of the name's first and
// last words, each a whole grapheme so an accent or a combining mark stays
// with its letter. A word with no letter in it (an emoji, a dash) doesn't
// count, and punctuation before a word's first letter is skipped, so
// '<script>' gives 'S'. Upper-cased only where that leaves one character
// ('ß' stays 'ß'). '' when the name has no letters at all.
export function initialsOf(name) {
  if (typeof name !== 'string') return '';
  const words = name.slice(0, NAME_MAX).trim().split(/\s+/);
  const firsts = words.flatMap((word) => {
    for (const { segment } of graphemes.segment(word)) {
      if (STARTS_WORD.test(segment)) return [upper(segment)];
    }
    return [];
  });
  if (firsts.length === 0) return '';
  return firsts.length === 1 ? firsts[0] : firsts[0] + firsts[firsts.length - 1];
}

function upper(grapheme) {
  const up = grapheme.toUpperCase();
  return [...graphemes.segment(up)].length === 1 ? up : grapheme;
}

export const colorOf = (value, fallback) => (typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback);

// A resume's accent as its site settings give it (client/src/resume/
// siteColors.js's normalizeSiteColors(): `colors.accent`, else an older
// site's flat `accent`), or the default's.
export function siteAccent(site) {
  return colorOf(site?.colors?.accent, null) ?? colorOf(site?.accent, DEFAULT_LANDING_COLORS.accent);
}

// WCAG 2 relative luminance of a #rrggbb color.
function relativeLuminance(hex) {
  const channel = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

const INK = '#14181c';
const INK_LUMINANCE = relativeLuminance(INK);

// Near-black or white, whichever has the higher WCAG contrast ratio
// against `background` (they cross at a luminance of about 0.2, a little
// above black's 0.179, since the ink isn't quite black). The same choice
// as the client's contrastTextFor() (client/src/resume/siteColors.js,
// issue #142), whose siteColors.test.js checks the two agree.
export function inkFor(background) {
  const fill = relativeLuminance(background);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return ratio(fill, INK_LUMINANCE) >= ratio(fill, 1) ? INK : '#ffffff';
}

// What the icon shows, and all it's drawn from: { initials, accent,
// darkAccent }, `darkAccent` the dark palette's accent or null. `name` and
// `site` are a published page's (routes/favicon.js), `darkColors` the
// landing page's resolved dark palette when it has one. With no arguments,
// the neutral mark in NEUTRAL_COLORS.
export function iconContent({ name = '', accent = NEUTRAL_COLORS.accent, darkColors = null } = {}) {
  return {
    initials: initialsOf(name),
    accent: colorOf(accent, NEUTRAL_COLORS.accent),
    darkAccent: darkColors ? colorOf(darkColors.accent, null) : null,
  };
}

// The SVG for `content` (iconContent()). /favicon.svg is a rounded tile
// that, when there's a dark accent, switches to it under
// `prefers-color-scheme: dark`; the PNG (`{ forRaster: true }`) is a
// full square in the light colors, since iOS rounds its corners itself and
// fills anything transparent with black.
export function faviconSvg(content, { forRaster = false } = {}) {
  const { initials, accent, darkAccent } = content;
  const ink = inkFor(accent);
  const dark = !forRaster && darkAccent ? darkAccent : null;
  const style = dark
    ? `<style>@media (prefers-color-scheme: dark){.tile{fill:${dark}}.ink{fill:${inkFor(dark)}}}</style>`
    : '';
  const radius = forRaster ? 0 : 14;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${VIEW}" height="${VIEW}" viewBox="0 0 ${VIEW} ${VIEW}">`,
    style,
    `<rect class="tile" width="${VIEW}" height="${VIEW}" rx="${radius}" fill="${accent}"/>`,
    initials ? initialsText(initials, ink) : neutralMark(ink),
    '</svg>',
  ];
  return parts.join('');
}

function initialsText(initials, ink) {
  const size = [...graphemes.segment(initials)].length > 1 ? 28 : 36;
  // y is the baseline: about a third of the size below the middle centers
  // a capital, without leaning on dominant-baseline, which not every
  // renderer supports.
  const baseline = Math.round(VIEW / 2 + size * 0.36);
  return (
    `<text class="ink" x="${VIEW / 2}" y="${baseline}" text-anchor="middle" fill="${ink}" ` +
    `font-family="${escapeHtml(FONT_FAMILY)}" font-size="${size}" font-weight="700">${escapeHtml(initials)}</text>`
  );
}

// Three lines of "text", for a page with no name.
function neutralMark(ink) {
  return [
    [16, 22, 32],
    [16, 31, 32],
    [16, 40, 22],
  ]
    .map(([x, y, width]) => `<rect class="ink" x="${x}" y="${y}" width="${width}" height="4" rx="2" fill="${ink}"/>`)
    .join('');
}

// A strong ETag for a response body: a hash of exactly what's sent.
export function etagOf(body) {
  return `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;
}
