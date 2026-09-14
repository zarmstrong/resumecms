// Shared link "type" catalog for header links. Each type drives a one-letter
// badge (shown across every header template) plus placeholder label/url
// values the editor prefills when a type is first selected.
export const LINK_TYPES = [
  { value: 'linkedin', label: 'LinkedIn', glyph: 'i', defaultLabel: 'linkedin.com/in/you', defaultUrl: 'https://linkedin.com/in/you' },
  { value: 'github', label: 'GitHub', glyph: 'g', defaultLabel: 'github.com/you', defaultUrl: 'https://github.com/you' },
  { value: 'gitlab', label: 'GitLab', glyph: 'l', defaultLabel: 'gitlab.com/you', defaultUrl: 'https://gitlab.com/you' },
  { value: 'website', label: 'Website / Portfolio', glyph: 'w', defaultLabel: 'yourwebsite.com', defaultUrl: 'https://yourwebsite.com' },
  { value: 'twitter', label: 'Twitter / X', glyph: 'x', defaultLabel: 'x.com/you', defaultUrl: 'https://x.com/you' },
  { value: 'stackoverflow', label: 'Stack Overflow', glyph: 's', defaultLabel: 'stackoverflow.com/users/you', defaultUrl: 'https://stackoverflow.com/users/you' },
  { value: 'medium', label: 'Medium', glyph: 'm', defaultLabel: 'medium.com/@you', defaultUrl: 'https://medium.com/@you' },
  { value: 'youtube', label: 'YouTube', glyph: 'y', defaultLabel: 'youtube.com/@you', defaultUrl: 'https://youtube.com/@you' },
  { value: 'custom', label: 'Custom', glyph: 'w', defaultLabel: '', defaultUrl: '' },
];

export const DEFAULT_LINK_TYPE = 'custom';

export function linkTypeConfig(type) {
  return LINK_TYPES.find((t) => t.value === type) || LINK_TYPES.find((t) => t.value === DEFAULT_LINK_TYPE);
}

// Legacy links saved before the `type` field existed only have a url. Infer
// a type from it so old LinkedIn/GitHub links still get the right badge.
export function inferLinkType(link) {
  if (link?.type && LINK_TYPES.some((t) => t.value === link.type)) return link.type;
  const u = (link?.url || '').toLowerCase();
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('github.com')) return 'github';
  if (u.includes('gitlab.com')) return 'gitlab';
  if (u.includes('stackoverflow.com')) return 'stackoverflow';
  if (u.includes('medium.com')) return 'medium';
  if (u.includes('youtube.com')) return 'youtube';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  return DEFAULT_LINK_TYPE;
}

export function linkGlyph(link) {
  return linkTypeConfig(inferLinkType(link)).glyph;
}
