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
