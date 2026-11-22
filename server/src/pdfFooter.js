// @ts-check
import { DEFAULT_FONT, FONT_IDS } from './landingStyle.js';
import { inkFor, relativeLuminance } from './favicon.js';

// What page.pdf() is given for a resume's PDF (issue #206): Letter with a
// half-inch margin on every side, plus, when the resume's site settings say
// `pdfPageNumbers: true`, Chromium's footer with "Page N of M" in the
// bottom margin. The margins never change, so turning it on moves nothing
// on the page. The page paints those margins in its own background (issue
// #213, usePrintBackground() in client/src/resume/pageStyle.js), so the
// footer is drawn on that color. Cover letters and share cards never get a
// footer.

export const PDF_BASE_OPTIONS = Object.freeze({
  format: 'Letter',
  printBackground: true,
  margin: Object.freeze({ top: '0.5in', bottom: '0.5in', left: '0.5in', right: '0.5in' }),
});

// FONT_IDS' sans-serif fonts (the client's FONT_OPTIONS whose css ends in
// sans-serif; pdfFooter.test.js compares them). Everything else, an
// unknown or missing font included, reads as DEFAULT_FONT does: a serif.
export const SANS_FONT_IDS = Object.freeze(['ibm-plex-sans', 'inter', 'roboto', 'open-sans', 'montserrat', 'work-sans']);

const SERIF_STACK = "Georgia, 'Times New Roman', serif";
const SANS_STACK = 'Helvetica, Arial, sans-serif';
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// The color the page paints its margins, from the site settings /print
// drew: the client's normalizeSiteColors() background (white when unset)
// while it's a #rrggbb, white otherwise, as printMarginColor() in
// client/src/resume/pageStyle.js leaves it (pageStyle.test.js compares
// the two).
const WHITE = '#ffffff';
/** @param {unknown} site */
export function pdfMarginColor(site) {
  const settings = /** @type {Record<string, any>} */ (site && typeof site === 'object' ? site : {});
  const background = settings.colors?.background;
  return typeof background === 'string' && HEX_COLOR.test(background) ? background : WHITE;
}

// The footer is drawn in that margin, so it always has WCAG AA contrast for
// normal text there: the resume's text color while it reads on the margin's
// color, otherwise whichever of near-black and white reads better
// (favicon.js's inkFor(), the client's contrastTextFor()). On some
// mid-tones neither of those reaches it (about 4.2:1 at worst), and then
// it's the better of pure black and white, one of which has at least
// 4.58:1 on any color.
const MIN_CONTRAST = 4.5;
const BLACK = '#000000';
const contrast = (a, b) => {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/**
 * @param {unknown} text
 * @param {string} margin a #rrggbb
 */
function footerInk(text, margin) {
  const reads = (color) => contrast(color, margin) >= MIN_CONTRAST;
  if (typeof text === 'string' && HEX_COLOR.test(text) && reads(text)) return text;
  const ink = inkFor(margin);
  if (reads(ink)) return ink;
  return contrast(BLACK, margin) >= contrast(WHITE, margin) ? BLACK : WHITE;
}

/**
 * @param {unknown} site the site settings of the snapshot /print was served
 * @returns {{} | { displayHeaderFooter: true, headerTemplate: string, footerTemplate: string }}
 */
export function pdfPageOptions(site) {
  const settings = /** @type {Record<string, any>} */ (site && typeof site === 'object' ? site : {});
  if (settings.pdfPageNumbers !== true) return {};
  const font = FONT_IDS.includes(settings.font) ? settings.font : DEFAULT_FONT;
  const family = SANS_FONT_IDS.includes(font) ? SANS_STACK : SERIF_STACK;
  // Only a #rrggbb value gets into the template, and nothing else from the
  // settings does, so nothing needs escaping.
  const color = footerInk(settings.colors?.text, pdfMarginColor(settings));
  // A footer template sees none of the page's stylesheets or web fonts, and
  // Chromium's default size for it is tiny, so everything is inline.
  const style = [
    'width: 100%',
    'text-align: center',
    'font-size: 8pt',
    `font-family: ${family}`,
    `color: ${color}`,
    '-webkit-print-color-adjust: exact',
  ].join('; ');
  return {
    displayHeaderFooter: true,
    // Without a header template Chromium draws its own: the date and title.
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="${style}">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
  };
}
