import { telHref } from './safeUrl.js';

// Shared link "type" catalog for header and landing page links. Each type
// drives a one-letter badge (shown across every header template and the
// landing page; the first letter of its name, so several share one, and no
// brand logos) plus placeholder label/url values the editor prefills when
// a type is first selected. `group` is the heading the editor's type
// dropdown lists it under, in this order, and `hosts` the sites
// inferLinkType() recognizes it by (the host itself or a subdomain of it).
// The server's list of type names is LINK_TYPES in
// server/src/landingFields.js, and the header enum in
// server/src/mcp/blockSchemas.js lists them too (issue #129).
export const LINK_TYPES = [
  { value: 'website', label: 'Website', group: 'General', glyph: 'w', defaultLabel: 'yourwebsite.com', defaultUrl: 'https://yourwebsite.com' },
  { value: 'portfolio', label: 'Portfolio', group: 'General', glyph: 'p', defaultLabel: 'yourportfolio.com', defaultUrl: 'https://yourportfolio.com' },
  { value: 'email', label: 'Email', group: 'General', glyph: 'e', defaultLabel: 'you@example.com', defaultUrl: 'mailto:you@example.com', urlFromLabel: emailUrl },
  { value: 'phone', label: 'Phone', group: 'General', glyph: 'p', defaultLabel: '+1 555 555 0100', defaultUrl: 'tel:+15555550100', urlFromLabel: (label) => telHref(label) || '' },
  { value: 'booking', label: 'Booking', group: 'General', glyph: 'b', defaultLabel: 'calendly.com/you', defaultUrl: 'https://calendly.com/you', hosts: ['calendly.com', 'cal.com', 'acuityscheduling.com'] },
  { value: 'shop', label: 'Shop', group: 'General', glyph: 's', defaultLabel: 'yourshop.com', defaultUrl: 'https://yourshop.com', hosts: ['etsy.com'] },
  { value: 'publications', label: 'Publications', group: 'General', glyph: 'p', defaultLabel: 'yourwebsite.com/publications', defaultUrl: 'https://yourwebsite.com/publications' },
  { value: 'newsletter', label: 'Newsletter', group: 'General', glyph: 'n', defaultLabel: 'yournewsletter.com', defaultUrl: 'https://yournewsletter.com' },
  { value: 'linkedin', label: 'LinkedIn', group: 'Social', glyph: 'i', defaultLabel: 'linkedin.com/in/you', defaultUrl: 'https://linkedin.com/in/you', hosts: ['linkedin.com'] },
  { value: 'twitter', label: 'Twitter / X', group: 'Social', glyph: 'x', defaultLabel: 'x.com/you', defaultUrl: 'https://x.com/you', hosts: ['twitter.com', 'x.com'] },
  { value: 'facebook', label: 'Facebook', group: 'Social', glyph: 'f', defaultLabel: 'facebook.com/you', defaultUrl: 'https://facebook.com/you', hosts: ['facebook.com', 'fb.com'] },
  { value: 'tiktok', label: 'TikTok', group: 'Social', glyph: 't', defaultLabel: 'tiktok.com/@you', defaultUrl: 'https://tiktok.com/@you', hosts: ['tiktok.com'] },
  { value: 'threads', label: 'Threads', group: 'Social', glyph: 't', defaultLabel: 'threads.com/@you', defaultUrl: 'https://threads.com/@you', hosts: ['threads.com', 'threads.net'] },
  { value: 'bluesky', label: 'Bluesky', group: 'Social', glyph: 'b', defaultLabel: 'you.bsky.social', defaultUrl: 'https://bsky.app/profile/you.bsky.social', hosts: ['bsky.app', 'bsky.social'] },
  { value: 'mastodon', label: 'Mastodon', group: 'Social', glyph: 'm', defaultLabel: '@you@mastodon.social', defaultUrl: 'https://mastodon.social/@you', hosts: ['mastodon.social', 'mastodon.online'] },
  { value: 'substack', label: 'Substack', group: 'Social', glyph: 's', defaultLabel: 'you.substack.com', defaultUrl: 'https://you.substack.com', hosts: ['substack.com'] },
  { value: 'medium', label: 'Medium', group: 'Social', glyph: 'm', defaultLabel: 'medium.com/@you', defaultUrl: 'https://medium.com/@you', hosts: ['medium.com'] },
  { value: 'github', label: 'GitHub', group: 'Software', glyph: 'g', defaultLabel: 'github.com/you', defaultUrl: 'https://github.com/you', hosts: ['github.com'] },
  { value: 'gitlab', label: 'GitLab', group: 'Software', glyph: 'l', defaultLabel: 'gitlab.com/you', defaultUrl: 'https://gitlab.com/you', hosts: ['gitlab.com'] },
  { value: 'stackoverflow', label: 'Stack Overflow', group: 'Software', glyph: 's', defaultLabel: 'stackoverflow.com/users/you', defaultUrl: 'https://stackoverflow.com/users/you', hosts: ['stackoverflow.com'] },
  { value: 'instagram', label: 'Instagram', group: 'Visual and creative', glyph: 'i', defaultLabel: 'instagram.com/you', defaultUrl: 'https://instagram.com/you', hosts: ['instagram.com'] },
  { value: 'behance', label: 'Behance', group: 'Visual and creative', glyph: 'b', defaultLabel: 'behance.net/you', defaultUrl: 'https://behance.net/you', hosts: ['behance.net'] },
  { value: 'dribbble', label: 'Dribbble', group: 'Visual and creative', glyph: 'd', defaultLabel: 'dribbble.com/you', defaultUrl: 'https://dribbble.com/you', hosts: ['dribbble.com'] },
  { value: 'artstation', label: 'ArtStation', group: 'Visual and creative', glyph: 'a', defaultLabel: 'artstation.com/you', defaultUrl: 'https://artstation.com/you', hosts: ['artstation.com'] },
  { value: 'vimeo', label: 'Vimeo', group: 'Visual and creative', glyph: 'v', defaultLabel: 'vimeo.com/you', defaultUrl: 'https://vimeo.com/you', hosts: ['vimeo.com'] },
  { value: 'youtube', label: 'YouTube', group: 'Visual and creative', glyph: 'y', defaultLabel: 'youtube.com/@you', defaultUrl: 'https://youtube.com/@you', hosts: ['youtube.com', 'youtu.be'] },
  { value: 'soundcloud', label: 'SoundCloud', group: 'Music and audio', glyph: 's', defaultLabel: 'soundcloud.com/you', defaultUrl: 'https://soundcloud.com/you', hosts: ['soundcloud.com'] },
  { value: 'bandcamp', label: 'Bandcamp', group: 'Music and audio', glyph: 'b', defaultLabel: 'you.bandcamp.com', defaultUrl: 'https://you.bandcamp.com', hosts: ['bandcamp.com'] },
  { value: 'spotify', label: 'Spotify', group: 'Music and audio', glyph: 's', defaultLabel: 'open.spotify.com/artist/you', defaultUrl: 'https://open.spotify.com/artist/you', hosts: ['spotify.com'] },
  { value: 'orcid', label: 'ORCID', group: 'Research', glyph: 'o', defaultLabel: 'orcid.org/0000-0000-0000-0000', defaultUrl: 'https://orcid.org/0000-0000-0000-0000', hosts: ['orcid.org'] },
  { value: 'googlescholar', label: 'Google Scholar', group: 'Research', glyph: 'g', defaultLabel: 'Google Scholar', defaultUrl: 'https://scholar.google.com/citations?user=you', hosts: ['scholar.google.com'] },
  { value: 'researchgate', label: 'ResearchGate', group: 'Research', glyph: 'r', defaultLabel: 'researchgate.net/profile/you', defaultUrl: 'https://researchgate.net/profile/you', hosts: ['researchgate.net'] },
  { value: 'imdb', label: 'IMDb', group: 'Film and stage', glyph: 'i', defaultLabel: 'imdb.com/name/nm0000000', defaultUrl: 'https://imdb.com/name/nm0000000', hosts: ['imdb.com'] },
  { value: 'houzz', label: 'Houzz', group: 'Local trades and services', glyph: 'h', defaultLabel: 'houzz.com/pro/you', defaultUrl: 'https://houzz.com/pro/you', hosts: ['houzz.com'] },
  { value: 'nextdoor', label: 'Nextdoor', group: 'Local trades and services', glyph: 'n', defaultLabel: 'nextdoor.com/pages/you', defaultUrl: 'https://nextdoor.com/pages/you', hosts: ['nextdoor.com'] },
  { value: 'googlebusiness', label: 'Google Business Profile', group: 'Local trades and services', glyph: 'g', defaultLabel: 'Find us on Google', defaultUrl: 'https://g.page/r/your-profile',hosts: ['business.google.com', 'g.page'] },
  { value: 'custom', label: 'Custom', group: 'Other', glyph: 'w', defaultLabel: '', defaultUrl: '' },
];

// The type dropdown's groups, in catalog order: [{ label, types }].
export const LINK_TYPE_GROUPS = LINK_TYPES.reduce((groups, type) => {
  const group = groups.find((g) => g.label === type.group);
  if (group) group.types.push(type);
  else groups.push({ label: type.group, types: [type] });
  return groups;
}, []);

export const DEFAULT_LINK_TYPE = 'custom';

function emailUrl(label) {
  const address = String(label || '').trim();
  return address ? `mailto:${address}` : '';
}

export function linkTypeConfig(type) {
  return LINK_TYPES.find((t) => t.value === type) || LINK_TYPES.find((t) => t.value === DEFAULT_LINK_TYPE);
}

// Legacy links saved before the `type` field existed only have a url. Infer
// a type from it so old LinkedIn/GitHub links still get the right badge. A
// site is matched by the URL's host, the site's own or a subdomain of it,
// so a lookalike like instagram.com.example stays Custom.
export function inferLinkType(link) {
  if (link?.type && LINK_TYPES.some((t) => t.value === link.type)) return link.type;
  const u = (link?.url || '').trim().toLowerCase();
  if (u.startsWith('mailto:')) return 'email';
  if (u.startsWith('tel:')) return 'phone';
  const host = urlHost(u);
  const match = host && LINK_TYPES.find((t) => t.hosts?.some((h) => host === h || host.endsWith(`.${h}`)));
  return match ? match.value : DEFAULT_LINK_TYPE;
}

// The host a link's URL names, '' if none. A URL typed without a scheme
// (linkedin.com/in/you) is read as https.
function urlHost(url) {
  try {
    return new URL(/^[a-z][a-z\d+.-]*:/.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return '';
  }
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
