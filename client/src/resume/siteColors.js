export const DEFAULT_SITE_COLORS = {
  accent: '#2f6f4e',
  heading: '#14181c',
  text: '#14181c',
  background: '#ffffff',
  // Optional per-element overrides. Empty string means "not set" — the
  // element falls back to its normal color (accent/slate) with no pill
  // background, so leaving these unset changes nothing.
  skillsCategoryText: '',
  skillsCategoryPill: '',
  datesText: '',
  datesPill: '',
};

// `site.colors` is the current shape. Older saved sites only have a flat
// `site.accent` field — fold that in as the accent default so upgrading
// doesn't reset anyone's saved color.
export function normalizeSiteColors(site) {
  const colors = (site && site.colors) || {};
  return {
    accent: colors.accent || site?.accent || DEFAULT_SITE_COLORS.accent,
    heading: colors.heading || DEFAULT_SITE_COLORS.heading,
    text: colors.text || DEFAULT_SITE_COLORS.text,
    background: colors.background || DEFAULT_SITE_COLORS.background,
    skillsCategoryText: colors.skillsCategoryText || DEFAULT_SITE_COLORS.skillsCategoryText,
    skillsCategoryPill: colors.skillsCategoryPill || DEFAULT_SITE_COLORS.skillsCategoryPill,
    datesText: colors.datesText || DEFAULT_SITE_COLORS.datesText,
    datesPill: colors.datesPill || DEFAULT_SITE_COLORS.datesPill,
  };
}

// Pill padding is a preset, not a free-form value, so the editor can offer
// it as a simple dropdown instead of raw CSS input.
export const PILL_PADDING_CSS = {
  compact: '0px 4px',
  snug: '1px 6px',
  cozy: '2px 8px',
  roomy: '3px 10px',
  spacious: '4px 12px',
};

export const DEFAULT_PILL_PADDING = 'cozy';

export function normalizePillPadding(site) {
  const value = site?.pillPadding;
  return PILL_PADDING_CSS[value] ? value : DEFAULT_PILL_PADDING;
}

// Curated resume typefaces. Each `css` value is loaded via the Google
// Fonts link in index.html (Georgia is a system font, so it needs nothing).
export const FONT_OPTIONS = [
  { value: 'source-serif', label: 'Source Serif 4', css: "'Source Serif 4', Georgia, serif" },
  { value: 'pt-serif', label: 'PT Serif', css: "'PT Serif', Georgia, serif" },
  { value: 'lora', label: 'Lora', css: "'Lora', Georgia, serif" },
  { value: 'merriweather', label: 'Merriweather', css: "'Merriweather', Georgia, serif" },
  { value: 'georgia', label: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  { value: 'ibm-plex-sans', label: 'IBM Plex Sans', css: "'IBM Plex Sans', system-ui, sans-serif" },
  { value: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
];

export const DEFAULT_FONT = 'source-serif';

export function normalizeResumeFont(site) {
  const value = site?.font;
  return FONT_OPTIONS.some((f) => f.value === value) ? value : DEFAULT_FONT;
}

export function fontCssFor(value) {
  return (FONT_OPTIONS.find((f) => f.value === value) || FONT_OPTIONS[0]).css;
}

// Name/title can optionally break from the main resume font. Empty means
// "match the site font" — the header inherits --font-resume as normal.
export function normalizeNameFont(site) {
  const value = site?.nameFont;
  return FONT_OPTIONS.some((f) => f.value === value) ? value : '';
}

export const FONT_SIZE_CSS = {
  smallest: '13px',
  small: '14.5px',
  normal: '16px',
  large: '17.5px',
  largest: '19px',
};

export const DEFAULT_FONT_SIZE = 'normal';

export function normalizeFontSize(site) {
  const value = site?.fontSize;
  return FONT_SIZE_CSS[value] ? value : DEFAULT_FONT_SIZE;
}

// Picks readable label text (white or near-black) for a given pill
// background color, so a solid-color tag stays legible without the user
// having to separately pick a matching text color.
export function contrastTextFor(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!match) return '#ffffff';
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness >= 150 ? '#14181c' : '#ffffff';
}
