// @ts-check
import { DEFAULT_FONT, DEFAULT_LANDING_COLORS, FONT_IDS } from './landingStyle.js';
import { colorOf, inkFor, relativeLuminance } from './favicon.js';

// What page.pdf() is given for a resume's PDF (issue #206): Letter with a
// half-inch margin on every side, plus, when the resume's site settings say
// `pdfPageNumbers: true`, Chromium's footer with "Page N of M" in the
// bottom margin. The margins never change, so turning it on moves nothing
// on the page. Cover letters and share cards never get a footer.

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

// The footer is drawn in the page's bottom margin, which resume.css's
// `@page` paints in the resume's background (issue #213). So the resume's
// text color is used while it reads on that background (WCAG AA for
// normal text), and near-black or white otherwise, whichever reads better
// on it (inkFor()). A background that isn't #rrggbb is read as the
// default white.
const MIN_CONTRAST = 4.5;
function contrast(a, b) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
function footerInk(text, background) {
  const fill = colorOf(background, DEFAULT_LANDING_COLORS.background);
  if (typeof text === 'string' && HEX_COLOR.test(text) && contrast(text, fill) >= MIN_CONTRAST) return text;
  return inkFor(fill);
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
  // Only a #rrggbb value gets into the template (the text color, or
  // inkFor()'s), and nothing else from the settings does, so nothing needs
  // escaping.
  const color = footerInk(settings.colors?.text, settings.colors?.background);
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
