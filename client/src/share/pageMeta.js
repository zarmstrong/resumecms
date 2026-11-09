// What a public page's title, description and share card say (issue #87),
// for the editor's link preview and the public pages' document.title.
// Mirrors server/src/pageMeta.js (resumePage(), landingPage()) and
// server/src/shareImages.js (cardContent()), which are what the HTML shell
// actually carries; keep the two in step.

import { inlinePlainText, parseInline } from '../landing/inlineText.js';
import { textParagraphs } from '../landing/resolveLanding.js';

export const DESCRIPTION_LENGTH = 160;
export const OVERRIDE_LIMITS = { title: 70, description: 200 };

const PHOTO_DATA_URL = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
// The landing page's uploaded photo (issue #92): the server's cardContent()
// takes it by its public path; the editor's preview has it at the
// editor's own.
const UPLOADED_PHOTO = /^\/api\/(?:public\/)?landing\/images\/[0-9a-f]{64}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const textOf = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
// A text section as a visitor reads it (issue #91), as the server's
// bodyPlainText() reads it: links as their labels, no markers.
const bodyText = (body) =>
  textParagraphs(typeof body === 'string' ? body : '')
    .map((paragraph) => inlinePlainText(parseInline(paragraph)))
    .join('\n\n');

export function clip(value, max) {
  const text = textOf(value);
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.–—-]+$/, '')}…`;
}

export function cardContent({ name, title, photoUrl, site }) {
  const shownName = typeof name === 'string' ? name.trim().slice(0, 120) : '';
  if (!shownName) return null;
  const s = isObject(site) ? site : {};
  return {
    name: shownName,
    title: typeof title === 'string' ? title.trim().slice(0, 200) : '',
    photoUrl: typeof photoUrl === 'string' && (PHOTO_DATA_URL.test(photoUrl) || UPLOADED_PHOTO.test(photoUrl)) ? photoUrl : '',
    site: {
      colors: isObject(s.colors) ? s.colors : {},
      accent: typeof s.accent === 'string' ? s.accent : '',
      font: typeof s.font === 'string' ? s.font : '',
      nameFont: typeof s.nameFont === 'string' ? s.nameFont : '',
    },
  };
}

// The first summary or executive summary shown on the web. Takes the
// public web list (a hidden block is a placeholder with `hidden`) or the
// editor's draft (a hidden block has visibleWeb false).
function summaryText(blocks) {
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (block.hidden || block.visibleWeb === false) continue;
    if (block.type === 'summary' && textOf(block.data?.text)) return block.data.text;
    if (block.type === 'executive_summary') {
      const text = textOf(block.data?.text) || textOf(block.data?.headline);
      if (text) return text;
    }
  }
  return '';
}

// A resume's page: its site settings' title and description, else the
// header's name and title and its first summary.
export function resumePageMeta(header, site, blocks) {
  const h = isObject(header) ? header : {};
  const s = isObject(site) ? site : {};
  const name = textOf(h.name);
  const jobTitle = textOf(h.title);
  return {
    title: clip(s.title, OVERRIDE_LIMITS.title) || [name, jobTitle].filter(Boolean).join(' – ') || 'Resume',
    description: clip(s.description, OVERRIDE_LIMITS.description) || clip(summaryText(blocks), DESCRIPTION_LENGTH),
    photoUrl: h.photoUrl || '',
    card: cardContent({ name, title: jobTitle, photoUrl: h.photoUrl, site: s }),
  };
}

// The landing page as resolveLanding() shows it: its seo, else the
// headline, and the subheadline or first text section. Its seo.image, when
// it has one, is the share image (`shareImage`) and no card is drawn.
export function landingPageMeta(landing) {
  const seo = isObject(landing?.seo) ? landing.seo : {};
  const sections = Array.isArray(landing?.sections) ? landing.sections : [];
  const headline = textOf(landing?.headline);
  const subheadline = textOf(landing?.subheadline);
  const firstText = sections.map((section) => (section.kind === 'text' ? bodyText(section.body) : '')).find(textOf);
  const shareImage = isObject(seo.image) && typeof seo.image.src === 'string' ? seo.image : null;
  return {
    title: textOf(seo.title) || headline || 'Home',
    description: textOf(seo.description) || clip(subheadline || firstText, DESCRIPTION_LENGTH),
    photoUrl: landing?.photoUrl || '',
    shareImage,
    card: shareImage ? null : cardContent({ name: headline, title: subheadline, photoUrl: landing?.photoUrl, site: landing?.site }),
  };
}
