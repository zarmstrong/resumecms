// Resume templates only affect layout (currently just the header). Colors,
// fonts, and section styling stay governed by siteColors.js regardless of
// which template is active.
export const TEMPLATE_OPTIONS = [
  { value: 'classic', label: 'Classic' },
  { value: 'labeled-header', label: 'Labeled contact header' },
  { value: 'centered', label: 'Centered' },
  { value: 'compact', label: 'Compact' },
  { value: 'banner', label: 'Accent banner' },
];

export const DEFAULT_TEMPLATE = 'classic';

export function normalizeTemplate(site) {
  const value = site?.template;
  return TEMPLATE_OPTIONS.some((t) => t.value === value) ? value : DEFAULT_TEMPLATE;
}
