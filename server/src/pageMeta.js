import { cardContent } from './shareImages.js';
import { bodyPlainText } from './inlineText.js';

// The search and link-preview metadata the HTML shell carries for a public
// page (issue #87): <title>, a description, Open Graph and Twitter card
// tags, a canonical link and, where the page is about the person, a
// JSON-LD Person. Link-preview crawlers (LinkedIn, Slack, iMessage) and
// most search crawlers never run the app's JavaScript, so this is all they
// see of the page. Pure: shellHead.js works out which page a request is
// for and hands this what that page shows.
//
// Everything here comes from a published snapshot (a resume's, or the
// landing page as resolveLanding() shows it), never a draft, and only from
// what the page itself shows: a summary hidden on the web never becomes
// the description. client/src/share/pageMeta.js mirrors the title and
// description rules for the editor's preview; keep the two in step.

export const DESCRIPTION_LENGTH = 160;
// The landing page's own overrides are capped on save (LANDING_LIMITS); a
// resume's live in its site settings, which aren't, so they're cut here.
export const OVERRIDE_LIMITS = { title: 70, description: 200 };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOf = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

// `text` with its whitespace collapsed, cut at a word boundary to at most
// `max` characters, an ellipsis marking the cut.
export function clip(value, max) {
  const text = textOf(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// JSON inside <script>: a `<` could close the tag (`</script>`) or open a
// comment, and U+2028/U+2029 end a line in older JavaScript parsers.
export function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function webLinks(links) {
  return (Array.isArray(links) ? links : [])
    .map((link) => (isObject(link) ? textOf(link.url) : ''))
    .filter((url) => {
      try {
        return ['http:', 'https:'].includes(new URL(url).protocol);
      } catch {
        return false;
      }
    });
}

// The first summary or executive summary a visitor sees on the web.
// `blocks` is the web list getPublishedResume('web') sends, in which a
// hidden block is a content-free placeholder.
function summaryText(blocks) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block.hidden) continue;
    if (block.type === 'summary' && textOf(block.data?.text)) return block.data.text;
    if (block.type === 'executive_summary') {
      const text = textOf(block.data?.text) || textOf(block.data?.headline);
      if (text) return text;
    }
  }
  return '';
}

// A resume's page, from getPublishedResume('web'). Its site settings'
// `title` (also the browser tab's) and `description` override what's
// derived from the header and the summary.
export function resumePage(published) {
  const header = isObject(published?.header) ? published.header : {};
  const site = isObject(published?.site) ? published.site : {};
  const name = textOf(header.name);
  const jobTitle = textOf(header.title);
  return {
    type: 'profile',
    title: clip(site.title, OVERRIDE_LIMITS.title) || [name, jobTitle].filter(Boolean).join(' – ') || 'Resume',
    description: clip(site.description, OVERRIDE_LIMITS.description) || clip(summaryText(published?.blocks), DESCRIPTION_LENGTH),
    photoUrl: header.photoUrl,
    imageAlt: name,
    card: cardContent({ name, title: jobTitle, photoUrl: header.photoUrl, site }),
    person: name ? { name, jobTitle, sameAs: webLinks(header.links) } : null,
  };
}

// The landing page, as resolveLanding() shows it. Its Person is the
// default resume's published header (`person`: the person the site is
// about, whose resume is public), the headline standing in for the name
// only when that has none. Its `seo.image` (issue #92), when it has one,
// is the share image (`shareImage`, { src, alt, width, height }) and no
// card is drawn.
export function landingPage(landing, defaultHeader) {
  const seo = isObject(landing?.seo) ? landing.seo : {};
  const sections = Array.isArray(landing?.sections) ? landing.sections : [];
  const headline = textOf(landing?.headline);
  const subheadline = textOf(landing?.subheadline);
  const firstText = sections.map((section) => (section.kind === 'text' ? bodyPlainText(section.body) : '')).find(textOf);
  const header = isObject(defaultHeader) ? defaultHeader : {};
  const name = textOf(header.name) || headline;
  const shareImage = isObject(seo.image) && typeof seo.image.src === 'string' ? seo.image : null;
  return {
    type: 'website',
    title: textOf(seo.title) || headline || 'Home',
    description: textOf(seo.description) || clip(subheadline || firstText, DESCRIPTION_LENGTH),
    photoUrl: landing?.photoUrl,
    imageAlt: textOf(shareImage?.alt) || headline || name,
    shareImage,
    card: shareImage ? null : cardContent({ name: headline, title: subheadline, photoUrl: landing?.photoUrl, site: landing?.site }),
    person: name
      ? {
          name,
          jobTitle: textOf(header.title) || subheadline,
          sameAs: sections.flatMap((section) => (section.kind === 'links' ? webLinks(section.links) : [])),
        }
      : null,
  };
}

// The tags for `page` (resumePage() or landingPage()) at `url`, the page's
// absolute canonical URL. `image` is the absolute URL of the image to show
// (the landing page's share image, else the share card when one is
// rendered, else the photo, else null), with `largeImage` true for the
// card or a wide share image, and `imageSize` its { width, height } when
// known; `photo` the photo's, for the Person. `withPerson` adds the
// JSON-LD (not on an unlisted /r/<slug> page).
export function headTags(page, { url, image = null, largeImage = false, imageSize = null, photo = null, withPerson = false }) {
  const tags = [`<title>${escapeHtml(page.title)}</title>`];
  const meta = (attr, key, value) => tags.push(`<meta ${attr}="${key}" content="${escapeHtml(value)}" />`);
  if (page.description) meta('name', 'description', page.description);
  tags.push(`<link rel="canonical" href="${escapeHtml(url)}" />`);
  meta('property', 'og:type', page.type);
  meta('property', 'og:title', page.title);
  if (page.description) meta('property', 'og:description', page.description);
  meta('property', 'og:url', url);
  if (image) {
    meta('property', 'og:image', image);
    if (imageSize) {
      meta('property', 'og:image:width', String(imageSize.width));
      meta('property', 'og:image:height', String(imageSize.height));
    }
    if (page.imageAlt) meta('property', 'og:image:alt', page.imageAlt);
  }
  meta('name', 'twitter:card', image && largeImage ? 'summary_large_image' : 'summary');
  meta('name', 'twitter:title', page.title);
  if (page.description) meta('name', 'twitter:description', page.description);
  if (image) meta('name', 'twitter:image', image);
  if (withPerson && page.person) {
    const person = { '@context': 'https://schema.org', '@type': 'Person', name: page.person.name, url };
    if (page.person.jobTitle) person.jobTitle = page.person.jobTitle;
    if (photo) person.image = photo;
    if (page.person.sameAs.length) person.sameAs = page.person.sameAs;
    tags.push(`<script type="application/ld+json">${jsonForScript(person)}</script>`);
  }
  return tags.join('\n    ');
}
