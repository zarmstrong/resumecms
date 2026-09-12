export const DEFAULT_SITE_COLORS = {
  accent: '#2f6f4e',
  heading: '#14181c',
  text: '#14181c',
  background: '#ffffff',
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
  };
}
