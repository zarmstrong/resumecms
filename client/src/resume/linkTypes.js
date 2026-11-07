import { telHref } from './safeUrl.js';

// Shared link "type" catalog for header and landing page links. Each type
// drives a one-letter badge (shown across every header template and the
// landing page) plus placeholder label/url values the editor prefills when
// a type is first selected. The server's list of type names is LINK_TYPES
// in server/src/landingFields.js.
export const LINK_TYPES = [
  { value: 'linkedin', label: 'LinkedIn', glyph: 'i', defaultLabel: 'linkedin.com/in/you', defaultUrl: 'https://linkedin.com/in/you' },
  { value: 'github', label: 'GitHub', glyph: 'g', defaultLabel: 'github.com/you', defaultUrl: 'https://github.com/you' },
  { value: 'gitlab', label: 'GitLab', glyph: 'l', defaultLabel: 'gitlab.com/you', defaultUrl: 'https://gitlab.com/you' },
  { value: 'website', label: 'Website / Portfolio', glyph: 'w', defaultLabel: 'yourwebsite.com', defaultUrl: 'https://yourwebsite.com' },
  { value: 'twitter', label: 'Twitter / X', glyph: 'x', defaultLabel: 'x.com/you', defaultUrl: 'https://x.com/you' },
  { value: 'stackoverflow', label: 'Stack Overflow', glyph: 's', defaultLabel: 'stackoverflow.com/users/you', defaultUrl: 'https://stackoverflow.com/users/you' },
  { value: 'medium', label: 'Medium', glyph: 'm', defaultLabel: 'medium.com/@you', defaultUrl: 'https://medium.com/@you' },
  { value: 'youtube', label: 'YouTube', glyph: 'y', defaultLabel: 'youtube.com/@you', defaultUrl: 'https://youtube.com/@you' },
  { value: 'email', label: 'Email', glyph: 'e', defaultLabel: 'you@example.com', defaultUrl: 'mailto:you@example.com', urlFromLabel: emailUrl },
  { value: 'phone', label: 'Phone', glyph: 'p', defaultLabel: '+1 555 555 0100', defaultUrl: 'tel:+15555550100', urlFromLabel: (label) => telHref(label) || '' },
  { value: 'custom', label: 'Custom', glyph: 'w', defaultLabel: '', defaultUrl: '' },
];

export const DEFAULT_LINK_TYPE = 'custom';

function emailUrl(label) {
  const address = String(label || '').trim();
  return address ? `mailto:${address}` : '';
}

export function linkTypeConfig(type) {
  return LINK_TYPES.find((t) => t.value === type) || LINK_TYPES.find((t) => t.value === DEFAULT_LINK_TYPE);
}

// Legacy links saved before the `type` field existed only have a url. Infer
// a type from it so old LinkedIn/GitHub links still get the right badge.
export function inferLinkType(link) {
  if (link?.type && LINK_TYPES.some((t) => t.value === link.type)) return link.type;
  const u = (link?.url || '').trim().toLowerCase();
  if (u.startsWith('mailto:')) return 'email';
  if (u.startsWith('tel:')) return 'phone';
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

// For a type whose URL is just its label in another form (email, phone),
// the URL a label change should leave behind: the new label's URL while
// the link's URL still follows its label (empty, or what the old label
// gave), and the URL as it is once it has been edited by hand. Undefined
// for other types.
export function followLabelUrl(link, label) {
  const toUrl = linkTypeConfig(inferLinkType(link)).urlFromLabel;
  if (!toUrl) return undefined;
  const url = link.url || '';
  return url === '' || url === toUrl(link.label || '') ? toUrl(label) : url;
}
