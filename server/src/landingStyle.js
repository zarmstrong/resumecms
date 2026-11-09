import { httpError } from './httpError.js';

// The landing page's look (issue #93), the pure half: which template
// arranges it, and whose colors and fonts it's drawn in. Stored in the
// draft as
//   template — a folder name under templates/landing/ ('classic' unless set).
//              The server never scans templates (the client's registry is
//              built at build time), so any well-formed id is kept and an
//              unknown one is drawn as 'classic', the way an unknown site
//              template is.
//   style    — { source, colors, font, nameFont, darkColors? }
//     source     'resume': the default resume's published site settings, as
//                before; 'custom': the four colors and two fonts below
//                (kept while source is 'resume', so switching back and
//                forth loses nothing)
//     colors     { accent, heading, text, background }, each '#rrggbb' or
//                '' for the site settings' default
//     font       a site font id, '' for the site settings' default
//     nameFont   a site font id for the headline and headings, '' to match
//     darkColors optional, the same four colors used under
//                `prefers-color-scheme: dark`, '' for the dark default.
//                Only stored when set, whatever the source: a resume has no
//                dark palette, so there's none to fall back on.
// The values follow the site settings' rules and normalizers
// (client/src/resume/siteColors.js): DEFAULT_SITE_COLORS, FONT_OPTIONS and
// DEFAULT_FONT are mirrored here, and client/src/landing/landingStyle.js
// mirrors landingSite() and darkPalette() for the editor's preview; its test
// compares both with these.

export const DEFAULT_LANDING_TEMPLATE = 'classic';
export const LANDING_STYLE_SOURCES = ['resume', 'custom'];
export const LANDING_COLOR_KEYS = ['accent', 'heading', 'text', 'background'];

// DEFAULT_SITE_COLORS's four, what an empty color is drawn as.
export const DEFAULT_LANDING_COLORS = { accent: '#2f6f4e', heading: '#14181c', text: '#14181c', background: '#ffffff' };
// What an empty dark color is drawn as: light text on a near-black page,
// with an accent light enough to read on it.
export const DEFAULT_DARK_COLORS = { accent: '#7cc4a0', heading: '#f2f4f6', text: '#d5dbe1', background: '#15191d' };

// FONT_OPTIONS' values, in its order.
export const FONT_IDS = [
  'source-serif',
  'pt-serif',
  'lora',
  'merriweather',
  'eb-garamond',
  'libre-baskerville',
  'playfair-display',
  'crimson-text',
  'georgia',
  'ibm-plex-sans',
  'inter',
  'roboto',
  'open-sans',
  'montserrat',
  'work-sans',
];
export const DEFAULT_FONT = 'source-serif';

const STYLE_FIELDS = ['source', 'colors', 'font', 'nameFont', 'darkColors'];
const TEMPLATE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TEMPLATE_ID_MAX = 64;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function emptyColors() {
  return Object.fromEntries(LANDING_COLOR_KEYS.map((key) => [key, '']));
}

export function emptyStyle() {
  return { source: 'resume', colors: emptyColors(), font: '', nameFont: '' };
}

export function checkTemplate(value) {
  if (typeof value !== 'string' || value.length > TEMPLATE_ID_MAX || !TEMPLATE_ID.test(value)) {
    throw httpError(400, 'template must be a template id: lowercase letters, digits and single dashes');
  }
  return value;
}

// '' or #rrggbb for each of the four, stored in lower case (what a color
// input gives).
function checkColors(colors, label) {
  if (!isPlainObject(colors)) throw httpError(400, `${label} must be an object`);
  const unknown = Object.keys(colors).find((key) => !LANDING_COLOR_KEYS.includes(key));
  if (unknown !== undefined) throw httpError(400, `Unknown ${label} field: ${unknown}`);
  return Object.fromEntries(
    LANDING_COLOR_KEYS.map((key) => {
      const value = colors[key] ?? '';
      if (typeof value !== 'string' || (value !== '' && !HEX_COLOR.test(value))) {
        throw httpError(400, `${label}.${key} must be a #rrggbb color, or '' for the default`);
      }
      return [key, value.toLowerCase()];
    })
  );
}

function checkFont(value, label) {
  if (value !== '' && !FONT_IDS.includes(value)) throw httpError(400, `${label} must be '' or one of ${FONT_IDS.join(', ')}`);
  return value;
}

export function checkStyle(style) {
  if (!isPlainObject(style)) throw httpError(400, 'style must be an object');
  const unknown = Object.keys(style).find((key) => !STYLE_FIELDS.includes(key));
  if (unknown !== undefined) throw httpError(400, `Unknown style field: ${unknown}`);
  const source = style.source ?? 'resume';
  if (!LANDING_STYLE_SOURCES.includes(source)) throw httpError(400, `style.source must be one of ${LANDING_STYLE_SOURCES.join(', ')}`);
  const out = {
    source,
    colors: checkColors(style.colors ?? {}, 'style.colors'),
    font: checkFont(style.font ?? '', 'style.font'),
    nameFont: checkFont(style.nameFont ?? '', 'style.nameFont'),
  };
  if (style.darkColors != null) out.darkColors = checkColors(style.darkColors, 'style.darkColors');
  return out;
}

// The MCP tool's merge of `style` (mergeLandingPatch()): one level deep,
// and `colors` and `darkColors` one more, the way setSite() merges a
// site's colors; a null removes a key (so `darkColors: null` drops the
// dark palette). The result is checked like any other.
export function mergeStylePatch(current, patch) {
  const base = isPlainObject(current) ? current : {};
  const out = mergeOne(base, patch);
  for (const key of ['colors', 'darkColors']) {
    if (isPlainObject(patch[key])) out[key] = mergeOne(isPlainObject(base[key]) ? base[key] : {}, patch[key]);
  }
  return out;
}

function mergeOne(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__') continue;
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

function paletteOf(colors, defaults) {
  const c = isPlainObject(colors) ? colors : {};
  return Object.fromEntries(LANDING_COLOR_KEYS.map((key) => [key, c[key] || defaults[key]]));
}

const fontOf = (value) => (FONT_IDS.includes(value) ? value : DEFAULT_FONT);
const nameFontOf = (value) => (FONT_IDS.includes(value) ? value : '');

// The `site` resolveLanding() gives the page: the default resume's
// published site settings (`resumeSite`), or the page's own colors and
// fonts, normalized, in the shape site settings have.
export function landingSite(style, resumeSite) {
  if (style?.source !== 'custom') return resumeSite ?? null;
  return { colors: paletteOf(style.colors, DEFAULT_LANDING_COLORS), font: fontOf(style.font), nameFont: nameFontOf(style.nameFont) };
}

// The dark palette, normalized, or null when there's none.
export function darkPalette(style) {
  return isPlainObject(style?.darkColors) ? paletteOf(style.darkColors, DEFAULT_DARK_COLORS) : null;
}

// What "Apply to the default resume" merges into that resume's site
// settings draft (setSite()'s merge, so its other settings and colors stay):
// the colors and fonts the page is drawn in, as landingSite() resolves
// them. Never the dark palette, which a resume has no use for. Only a page
// with colors of its own has any to give.
export function resumeSitePatch(style) {
  if (style?.source !== 'custom') {
    throw httpError(400, "The landing page uses the default resume's colors and fonts: give it its own first");
  }
  return landingSite(style, null);
}
