import {
  DEFAULT_FONT,
  DEFAULT_SITE_COLORS,
  FONT_OPTIONS,
  FONT_SIZE_CSS,
  contrastTextFor,
  fontCssFor,
  normalizeFontSize,
  normalizeNameFont,
  normalizeResumeFont,
  normalizeSiteColors,
} from '../resume/siteColors.js';

// The landing page's look (issue #93): its `style` as resolveLanding()
// turns it into the page's `site` and `darkColors`, mirroring
// server/src/landingStyle.js (landingSite(), darkPalette() and the dark
// defaults; landingStyle.test.js compares the two), and both as the CSS
// custom properties LandingView sets (landing.css reads them).

export const LANDING_COLOR_KEYS = ['accent', 'heading', 'text', 'background'];

// What an empty dark color is drawn as (the server's DEFAULT_DARK_COLORS).
export const DEFAULT_DARK_COLORS = { accent: '#7cc4a0', heading: '#f2f4f6', text: '#d5dbe1', background: '#15191d' };

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isFont = (value) => FONT_OPTIONS.some((f) => f.value === value);

// The rule a color has to follow to save (the server's checkStyle()).
export const isHexColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

function paletteOf(colors, defaults) {
  const c = isPlainObject(colors) ? colors : {};
  return Object.fromEntries(LANDING_COLOR_KEYS.map((key) => [key, c[key] || defaults[key]]));
}

// The default resume's published site settings (`resumeSite`), or the
// page's own colors and fonts in the shape site settings have.
export function landingSite(style, resumeSite) {
  if (style?.source !== 'custom') return resumeSite ?? null;
  return {
    colors: paletteOf(style.colors, DEFAULT_SITE_COLORS),
    font: isFont(style.font) ? style.font : DEFAULT_FONT,
    nameFont: isFont(style.nameFont) ? style.nameFont : '',
  };
}

// The dark palette, normalized, or null when there's none.
export function darkPalette(style) {
  return isPlainObject(style?.darkColors) ? paletteOf(style.darkColors, DEFAULT_DARK_COLORS) : null;
}

// The resolved page's look as LandingView's root style: `--l-*` for its
// colors, `--l-dark-*` for its dark palette when it has one, and the
// fonts as resume.css takes them. `colors` are the light ones, normalized.
export function landingPageStyle(site, darkColors) {
  const colors = normalizeSiteColors(site);
  const style = {
    '--l-accent': colors.accent,
    '--l-heading': colors.heading,
    '--l-text': colors.text,
    '--l-bg': colors.background,
    '--l-on-accent': contrastTextFor(colors.accent),
    '--font-resume': fontCssFor(normalizeResumeFont(site)),
    '--r-font-size': FONT_SIZE_CSS[normalizeFontSize(site)],
  };
  const nameFont = normalizeNameFont(site);
  if (nameFont) style['--r-name-font'] = fontCssFor(nameFont);
  if (darkColors) {
    style['--l-dark-accent'] = darkColors.accent;
    style['--l-dark-heading'] = darkColors.heading;
    style['--l-dark-text'] = darkColors.text;
    style['--l-dark-bg'] = darkColors.background;
    style['--l-dark-on-accent'] = contrastTextFor(darkColors.accent);
  }
  return { colors, style };
}

// The class that switches a page with a dark palette to it: under the
// visitor's dark setting ('auto', the public page), always ('dark', the
// editor's dark preview) or never ('light').
export function darkClass(darkColors, scheme = 'auto') {
  if (!darkColors || scheme === 'light') return '';
  return scheme === 'dark' ? 'l-dark-on' : 'l-dark-auto';
}

// What the Look group's "Its own" starts from, the first time it's picked:
// the colors and fonts the page shows right now (the default resume's
// published ones), so switching changes nothing until something is. Site
// settings aren't checked on save, so a color that isn't #rrggbb (one
// half typed there) starts out as the default instead of failing the
// page's save.
export function ownStyleFrom(style, resumeSite) {
  const colors = normalizeSiteColors(resumeSite);
  const untouched = !style?.font && !style?.nameFont && LANDING_COLOR_KEYS.every((key) => !style?.colors?.[key]);
  if (!untouched) return { ...style, source: 'custom' };
  return {
    ...style,
    source: 'custom',
    colors: Object.fromEntries(LANDING_COLOR_KEYS.map((key) => [key, isHexColor(colors[key]) ? colors[key].toLowerCase() : ''])),
    font: normalizeResumeFont(resumeSite),
    nameFont: normalizeNameFont(resumeSite),
  };
}
