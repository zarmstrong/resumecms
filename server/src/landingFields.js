import { randomUUID } from 'node:crypto';
import { httpError } from './httpError.js';
import { blocksForMode } from './publicBlocks.js';
import { inlineLength, inlineLinks, parseInline, textParagraphs } from './inlineText.js';
import { LANDING_IMAGE_LIMITS, checkImageRef, resolveImage } from './landingImageFields.js';
import { DEFAULT_LANDING_TEMPLATE, checkStyle, checkTemplate, darkPalette, emptyStyle, landingSite, mergeStylePatch } from './landingStyle.js';
import { hasPassed, utcToday } from './dateText.js';
import { parseMediaUrl } from './mediaUrl.js';

// The optional landing page at `/` (issue #70): a short home page with a
// headline, a photo and a list of sections. Pure validation and shaping
// here; landingStore.js stores it and decides which hosts get it.
//
// The draft is a fixed set of fields, all always present once stored:
//   { headline, subheadline, availability, actions, photo, photoUrl, sections, seo, homeLink, homeLinkLabel, template, style }
// `availability` is a short line shown above the headline ("Open to senior
// backend roles · Remote"), '' for none. `actions` (issue #88) are the
// hero's buttons, at most three, the first drawn as the primary one:
//   { type: 'link', label, url, icon? }
//   { type: 'resume', label, resumeId, open: 'page' | 'pdf', icon? }
// A resume action follows a card's rules (see resolveLanding()). `icon`,
// stored only when set, is one of ACTION_ICONS, drawn before the label.
// `photo` says where the photo comes from: 'resume' (the default resume's
// published header photo), 'custom' (photoUrl), 'upload' (photoImage, an
// uploaded image's reference, issue #92) or 'none'. `sections` is
// shown in order under the headline, each `{ id, kind, title, ... }` with
// the fields of its kind (SECTION_FIELDS):
//   text       — body: text, a blank line between paragraphs
//   items      — items: [{ title, text, url, meta?, image? }], e.g.
//                projects; meta is a short muted line under the title
//                ("2024 · Rust"), image an optional thumbnail
//   links      — links: [{ type, label, url }]
//   resumes    — cards: [{ resumeId, label, blurb, showPdf }] linking to
//                resumes, with the PDF next to the page when showPdf is on
//   quotes     — quotes: [{ text, name, role, url }], testimonials
//   experience — resumeId, count, showDates: the first `count` roles of
//                that resume, read from its published snapshot when the
//                page is requested (issue #90), never copied into the draft
//   image      — image (a reference, or null until one is uploaded), caption
//   divider    — nothing but its title: a rule across the page, the title
//                (if any) a label on it
//   stats      — stats: [{ value, label }], a few large figures ("2,000+",
//                "$4.2M", "15 years") each over a short label (issue #125);
//                both plain text, so a value needn't be a number
//   faq        — entries: [{ question, answer }] (issue #123), each answer
//                collapsed under its question
//   education  — resumeId, count, showDates: the first `count` education
//                entries of that resume, read like experience's (issue #126)
//   skills     — resumeId: every skill group that resume shows on the web,
//                read like experience's (issue #126)
//   credentials — credentials: [{ kind, name, issuer, number, issued,
//                expires, url }], licenses, certifications and memberships
//                (issue #119); `kind` only picks the label shown with it,
//                the dates are free-form (dateText.js reads them) and `url`
//                is the issuer's page to verify it on
//   gallery    — images: [{ image, caption }] (issue #120), drawn as a grid
//                that opens each larger; an entry's image is a reference, or
//                null until its upload lands, and its caption plain text
//   media      — url, caption, poster?, transcript (issue #121): one video
//                or audio clip from YouTube, Vimeo, SoundCloud or Spotify
//                (mediaUrl.js; any other link is a 400, '' allowed while
//                there's none yet), drawn behind a click-to-load facade;
//                `poster` an optional image reference shown on it, the
//                caption and transcript plain text
// Any section may also be `hidden: true` (issue #90): kept in the draft,
// never shown, and `column: 'side'`: drawn in the side column by a
// template that has one (template.json's `columns`, e.g. split's column
// under the hero) and in the main flow by every other. `hidden`, `column`
// and an item's `meta` are only stored when set.
// A text section's body, an item's text and an FAQ answer may hold links
// and emphasis (issue #91, inlineText.js); every other string, a quote's
// text, an item's meta, a stat and an FAQ question included, is plain
// text.
// `id` only tells sections apart in the editor; it never leaves the server
// publicly. `seo` is { title, description, noindex } (issue #87): what
// the page's <title>, description and link previews say instead of the
// headline and subheadline (see pageMeta.js), and whether search engines
// are asked to leave it out, plus an optional `image`, the share image
// link previews show instead of a drawn card. Image references
// ({ imageId, alt }, landingImageFields.js) are stored only where one is
// set: `photoImage`, an item's `image`, a media section's `poster` and `seo.image` are optional keys,
// not nulls. `homeLink` (issue #89) is whether a resume
// page shows a "← Home" link back here while this page holds `/` (see
// landingStore.js's homeLinkForHost()), and `homeLinkLabel` what it says
// after the arrow ('' for "Home"). `template` and `style` (issue #93,
// landingStyle.js) are the page's look: which template arranges it, and
// whether it's drawn in the default resume's colors and fonts or its own,
// with an optional dark palette. A draft stored before sections, `seo`,
// `homeLink` or `style` existed is read through upgradeLanding().
//
// Everything here ends up in front of every visitor, so it's checked more
// strictly than the header: unknown keys, wrong types and oversized values
// are a 400 on save, links can't use a script-running scheme, and the photo
// can only be an inline image or a stored upload's reference.
// resolveLanding() is the only shape that may leave the server publicly.

export const LANDING_LIMITS = {
  headline: 120,
  subheadline: 200,
  availability: 80,
  actions: 3,
  actionLabel: 60,
  sections: 20,
  sectionTitle: 120,
  text: 4000,
  items: 20,
  itemTitle: 120,
  itemText: 1000,
  links: 12,
  linkLabel: 100,
  url: 2048,
  cards: 12,
  cardLabel: 100,
  blurb: 400,
  itemMeta: 80,
  quotes: 10,
  quoteText: 600,
  quoteName: 100,
  quoteRole: 120,
  experienceCount: 10,
  stats: 6,
  statValue: 16,
  statLabel: 80,
  faqEntries: 15,
  faqQuestion: 200,
  faqAnswer: 1500,
  educationCount: 10,
  credentials: 20,
  credentialName: 120,
  credentialIssuer: 120,
  credentialNumber: 60,
  credentialDate: 40,
  galleryImages: 24,
  mediaCaption: 300,
  // About a twenty-minute talk.
  transcript: 20_000,
  // About what a search result shows before cutting it off.
  seoTitle: 70,
  seoDescription: 200,
  homeLinkLabel: 40,
  // About 512 KB of image once base64-decoded; the editor's cropper makes
  // a 480 px JPEG of well under that.
  photoUrl: 700_000,
};

export const PHOTO_SOURCES = ['resume', 'custom', 'upload', 'none'];

// The header's link types (client/src/resume/linkTypes.js), which only pick
// the badge a link is drawn with, in the same order (issue #129; the
// client's linkTypes.test.js compares them).
export const LINK_TYPES = [
  'website', 'portfolio', 'email', 'phone', 'booking', 'shop', 'publications', 'newsletter',
  'linkedin', 'twitter', 'facebook', 'tiktok', 'threads', 'bluesky', 'mastodon', 'substack', 'medium',
  'github', 'gitlab', 'stackoverflow',
  'instagram', 'behance', 'dribbble', 'artstation', 'vimeo', 'youtube',
  'soundcloud', 'bandcamp', 'spotify',
  'orcid', 'googlescholar', 'researchgate',
  'imdb',
  'houzz', 'nextdoor', 'googlebusiness',
  'custom',
];

export const SECTION_KINDS = ['text', 'items', 'links', 'resumes', 'quotes', 'experience', 'image', 'divider', 'stats', 'faq', 'education', 'skills', 'credentials', 'gallery', 'media'];
// Where a section goes in a template with two columns; 'main' isn't stored.
export const SECTION_COLUMNS = ['main', 'side'];

export const ACTION_TYPES = ['link', 'resume'];
export const ACTION_OPENS = ['page', 'pdf'];
// The icons a button may show before its label: the names of the Font
// Awesome Free icons in client/src/landing/actionIcons.js, which draws them.
export const ACTION_ICONS = [
  'envelope', 'paper-plane', 'phone', 'comments', 'calendar-days', 'calendar-check', 'video', 'mug-hot', 'handshake',
  'file-pdf', 'file-lines', 'download', 'briefcase', 'graduation-cap', 'book', 'pen',
  'globe', 'link', 'code', 'laptop-code', 'rocket', 'star', 'user', 'location-dot', 'circle-check',
  'linkedin', 'github', 'gitlab', 'x-twitter', 'bluesky', 'mastodon', 'stack-overflow', 'medium', 'youtube', 'instagram', 'dribbble', 'behance', 'discord',
];

const FIELDS = ['headline', 'subheadline', 'availability', 'actions', 'photo', 'photoUrl', 'photoImage', 'sections', 'seo', 'homeLink', 'homeLinkLabel', 'template', 'style'];
const SEO_FIELDS = ['title', 'description', 'noindex', 'image'];
const SECTION_FIELDS = {
  text: ['id', 'kind', 'title', 'hidden', 'column', 'body'],
  items: ['id', 'kind', 'title', 'hidden', 'column', 'items'],
  links: ['id', 'kind', 'title', 'hidden', 'column', 'links'],
  resumes: ['id', 'kind', 'title', 'hidden', 'column', 'cards'],
  quotes: ['id', 'kind', 'title', 'hidden', 'column', 'quotes'],
  experience: ['id', 'kind', 'title', 'hidden', 'column', 'resumeId', 'count', 'showDates'],
  image: ['id', 'kind', 'title', 'hidden', 'column', 'image', 'caption'],
  divider: ['id', 'kind', 'title', 'hidden', 'column'],
  stats: ['id', 'kind', 'title', 'hidden', 'column', 'stats'],
  faq: ['id', 'kind', 'title', 'hidden', 'column', 'entries'],
  education: ['id', 'kind', 'title', 'hidden', 'column', 'resumeId', 'count', 'showDates'],
  skills: ['id', 'kind', 'title', 'hidden', 'column', 'resumeId'],
  credentials: ['id', 'kind', 'title', 'hidden', 'column', 'credentials'],
  gallery: ['id', 'kind', 'title', 'hidden', 'column', 'images'],
  media: ['id', 'kind', 'title', 'hidden', 'column', 'url', 'caption', 'poster', 'transcript'],
};
const ITEM_FIELDS = ['title', 'text', 'url', 'meta', 'image'];
const QUOTE_FIELDS = ['text', 'name', 'role', 'url'];
const STAT_FIELDS = ['value', 'label'];
const FAQ_FIELDS = ['question', 'answer'];
const CREDENTIAL_FIELDS = ['kind', 'name', 'issuer', 'number', 'issued', 'expires', 'url'];
const GALLERY_ENTRY_FIELDS = ['image', 'caption'];
// What a credential is; only picks the label it's shown with.
export const CREDENTIAL_KINDS = ['license', 'certification', 'membership'];
// What an experience section shows when it's added without saying.
export const EXPERIENCE_DEFAULTS = { count: 3, showDates: true };
// And an education section.
export const EDUCATION_DEFAULTS = { count: 3, showDates: true };
const LINK_FIELDS = ['type', 'label', 'url'];
const CARD_FIELDS = ['resumeId', 'label', 'blurb', 'showPdf'];
const ACTION_FIELDS = {
  link: ['type', 'label', 'url', 'icon'],
  resume: ['type', 'label', 'resumeId', 'open', 'icon'],
};
const SECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];
const PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

function emptySeo() {
  return { title: '', description: '', noindex: false };
}

export function emptyLanding() {
  return {
    headline: '',
    subheadline: '',
    availability: '',
    actions: [],
    photo: 'resume',
    photoUrl: '',
    sections: [],
    seo: emptySeo(),
    homeLink: true,
    homeLinkLabel: '',
    template: DEFAULT_LANDING_TEMPLATE,
    style: emptyStyle(),
  };
}

// What a resume page's link back to the landing page points at, and says
// while its `homeLinkLabel` is empty (issue #89); the client draws it as
// "← Home".
export const HOME_LINK = { href: '/', label: 'Home' };

// A draft or snapshot as stored before sections (issue #70's first shape:
// `intro`, `links` and `resumes` as fields of their own), turned into the
// sections it showed, in the order it showed them, one stored before `seo`,
// `availability`, `actions` or `homeLinkLabel` given the empty ones, one
// stored before `homeLink` given it switched on, one stored before
// `template` or `style` the look it had (classic, the default resume's
// colors and fonts), and a card stored before
// `showPdf` given false. The ids are fixed, so reading the same
// stored draft twice gives the same sections; one already in the current
// shape comes back as it is.
export function upgradeLanding(stored) {
  if (!isPlainObject(stored)) return stored;
  let upgraded = stored;
  if (!Array.isArray(stored.sections)) {
    const { intro, links, resumes, ...rest } = stored;
    const sections = [];
    if (typeof intro === 'string' && intro !== '') sections.push({ id: 'intro', kind: 'text', title: '', body: intro });
    if (Array.isArray(links) && links.length) sections.push({ id: 'links', kind: 'links', title: '', links });
    if (Array.isArray(resumes) && resumes.length) sections.push({ id: 'resumes', kind: 'resumes', title: '', cards: resumes });
    upgraded = { ...rest, sections };
  }
  if (!isPlainObject(upgraded.seo)) upgraded = { ...upgraded, seo: emptySeo() };
  if (typeof upgraded.availability !== 'string') upgraded = { ...upgraded, availability: '' };
  if (!Array.isArray(upgraded.actions)) upgraded = { ...upgraded, actions: [] };
  if (typeof upgraded.homeLink !== 'boolean') upgraded = { ...upgraded, homeLink: true };
  if (typeof upgraded.homeLinkLabel !== 'string') upgraded = { ...upgraded, homeLinkLabel: '' };
  if (typeof upgraded.template !== 'string') upgraded = { ...upgraded, template: DEFAULT_LANDING_TEMPLATE };
  if (!isPlainObject(upgraded.style)) upgraded = { ...upgraded, style: emptyStyle() };
  const needsShowPdf = (section) => section?.kind === 'resumes' && Array.isArray(section.cards) && section.cards.some((card) => isPlainObject(card) && !('showPdf' in card));
  if (upgraded.sections.some(needsShowPdf)) {
    upgraded = {
      ...upgraded,
      sections: upgraded.sections.map((section) =>
        needsShowPdf(section) ? { ...section, cards: section.cards.map((card) => (isPlainObject(card) && !('showPdf' in card) ? { ...card, showPdf: false } : card)) } : section
      ),
    };
  }
  return upgraded;
}

// Every resume `landing` names: a card's in any section, an experience,
// education or skills section's, or a hero action's.
export function referencedResumeIds(landing) {
  return new Set([
    ...(landing.sections || []).flatMap((section) => {
      if (section.kind === 'resumes') return section.cards.map((card) => card.resumeId);
      return ['experience', 'education', 'skills'].includes(section.kind) ? [section.resumeId] : [];
    }),
    ...(landing.actions || []).flatMap((action) => (action.type === 'resume' ? [action.resumeId] : [])),
  ]);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function checkKeys(value, allowed, label) {
  if (!isPlainObject(value)) throw httpError(400, `${label} must be an object`);
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw httpError(400, `Unknown ${label} field: ${unknown}`);
}

function checkString(value, max, label) {
  if (typeof value !== 'string') throw httpError(400, `${label} must be a string`);
  if (value.length > max) throw httpError(400, `${label} is too long (at most ${max} characters)`);
  return value;
}

// The rule the client's safeHref() applies, judged the same way a browser
// would read the href: resolved against the page, so a relative or
// half-typed URL counts as the page's own scheme, and the WHATWG parser
// strips the tabs, newlines and leading spaces that could otherwise hide a
// `javascript:`. Empty means "no URL yet" and is allowed in a draft;
// resolveLanding() leaves such links out.
export function isSafeUrl(url) {
  if (url === '') return true;
  try {
    return SAFE_SCHEMES.includes(new URL(url, 'https://landing.invalid/').protocol);
  } catch {
    return false;
  }
}

// What a draft may hold: anything but a URL with another scheme. One the
// parser rejects outright (`https://` mid-typing) can't be followed as a
// link either, so the editor's save goes through while someone types;
// resolveLanding() leaves it out, as the client's safeHref() would.
function isAllowedDraftUrl(url) {
  try {
    new URL(url, 'https://landing.invalid/');
  } catch {
    return true;
  }
  return isSafeUrl(url);
}

// A text section's body (`paragraphs`, read one paragraph at a time as the
// page shows it) or an item's text. Its cap counts the text as written,
// markup and all, but not an escaping backslash (inlineLength()), so the
// one-off escape of older text (landingTextMigration.js) never takes a
// field over it. Its links follow the rule every other link on the page
// does.
function checkInlineText(value, max, label, { paragraphs = false } = {}) {
  if (typeof value !== 'string') throw httpError(400, `${label} must be a string`);
  if (inlineLength(value) > max) throw httpError(400, `${label} is too long (at most ${max} characters)`);
  (paragraphs ? textParagraphs(value) : [value]).forEach((part, p) => {
    const bad = inlineLinks(parseInline(part)).find((link) => !isAllowedDraftUrl(link.href));
    if (bad) {
      const where = paragraphs ? `${label}, paragraph ${p + 1}` : label;
      throw httpError(400, `${where}: the link "${bad.label.slice(0, 40)}" must be an http, https, mailto or tel link`);
    }
  });
  return value;
}

function checkLink(link, label) {
  checkKeys(link, LINK_FIELDS, label);
  const out = {
    label: checkString(link.label ?? '', LANDING_LIMITS.linkLabel, `${label}.label`),
    url: checkString(link.url ?? '', LANDING_LIMITS.url, `${label}.url`),
  };
  if (link.type !== undefined) {
    if (!LINK_TYPES.includes(link.type)) throw httpError(400, `${label}.type must be one of ${LINK_TYPES.join(', ')}`);
    out.type = link.type;
  }
  if (!isAllowedDraftUrl(out.url)) throw httpError(400, `${label}.url must be an http, https, mailto or tel link`);
  return out;
}

// A card or resume action already in the draft keeps its place even if its
// resume has since been deleted (the editor would otherwise be unable to
// save anything until it's removed; nothing shows it publicly). A new one
// has to name a resume that exists.
function checkResumeRef(value, label, { knownResumeIds, previousResumeIds }) {
  const resumeId = checkString(value, 200, label);
  if (!knownResumeIds.has(resumeId) && !previousResumeIds.has(resumeId)) {
    throw httpError(400, `${label} does not reference an existing resume`);
  }
  return resumeId;
}

function checkBoolean(value, label) {
  if (typeof value !== 'boolean') throw httpError(400, `${label} must be a boolean`);
  return value;
}

function checkCard(card, label, refs, seen) {
  checkKeys(card, CARD_FIELDS, label);
  const resumeId = checkString(card.resumeId, 200, `${label}.resumeId`);
  if (seen.has(resumeId)) throw httpError(400, `${label}: that resume already has a card in this section`);
  seen.add(resumeId);
  checkResumeRef(resumeId, `${label}.resumeId`, refs);
  return {
    resumeId,
    label: checkString(card.label ?? '', LANDING_LIMITS.cardLabel, `${label}.label`),
    blurb: checkString(card.blurb ?? '', LANDING_LIMITS.blurb, `${label}.blurb`),
    showPdf: checkBoolean(card.showPdf ?? false, `${label}.showPdf`),
  };
}

function checkAction(action, label, refs) {
  if (!isPlainObject(action)) throw httpError(400, `${label} must be an object`);
  if (!ACTION_TYPES.includes(action.type)) throw httpError(400, `${label}.type must be one of ${ACTION_TYPES.join(', ')}`);
  checkKeys(action, ACTION_FIELDS[action.type], label);
  const out = { type: action.type, label: checkString(action.label ?? '', LANDING_LIMITS.actionLabel, `${label}.label`) };
  if (action.type === 'link') {
    out.url = checkString(action.url ?? '', LANDING_LIMITS.url, `${label}.url`);
    if (!isAllowedDraftUrl(out.url)) throw httpError(400, `${label}.url must be an http, https, mailto or tel link`);
  } else {
    out.resumeId = checkResumeRef(action.resumeId, `${label}.resumeId`, refs);
    out.open = action.open ?? 'page';
    if (!ACTION_OPENS.includes(out.open)) throw httpError(400, `${label}.open must be one of ${ACTION_OPENS.join(', ')}`);
  }
  const icon = action.icon ?? '';
  if (icon !== '') {
    if (!ACTION_ICONS.includes(icon)) throw httpError(400, `${label}.icon must be one of ${ACTION_ICONS.join(', ')}`);
    out.icon = icon;
  }
  return out;
}

function checkList(value, max, label) {
  const list = value ?? [];
  if (!Array.isArray(list)) throw httpError(400, `${label} must be an array`);
  if (list.length > max) throw httpError(400, `${label}: at most ${max}`);
  return list;
}

function checkItem(item, label, refs) {
  checkKeys(item, ITEM_FIELDS, label);
  const out = {
    title: checkString(item.title ?? '', LANDING_LIMITS.itemTitle, `${label}.title`),
    text: checkInlineText(item.text ?? '', LANDING_LIMITS.itemText, `${label}.text`),
    url: checkString(item.url ?? '', LANDING_LIMITS.url, `${label}.url`),
  };
  if (!isAllowedDraftUrl(out.url)) throw httpError(400, `${label}.url must be an http, https, mailto or tel link`);
  const meta = checkString(item.meta ?? '', LANDING_LIMITS.itemMeta, `${label}.meta`);
  if (meta !== '') out.meta = meta;
  if (item.image != null) out.image = checkImageRef(item.image, `${label}.image`, refs);
  return out;
}

function checkQuote(quote, label) {
  checkKeys(quote, QUOTE_FIELDS, label);
  const out = {
    text: checkString(quote.text ?? '', LANDING_LIMITS.quoteText, `${label}.text`),
    name: checkString(quote.name ?? '', LANDING_LIMITS.quoteName, `${label}.name`),
    role: checkString(quote.role ?? '', LANDING_LIMITS.quoteRole, `${label}.role`),
    url: checkString(quote.url ?? '', LANDING_LIMITS.url, `${label}.url`),
  };
  if (!isAllowedDraftUrl(out.url)) throw httpError(400, `${label}.url must be an http, https, mailto or tel link`);
  return out;
}

function checkStat(stat, label) {
  checkKeys(stat, STAT_FIELDS, label);
  return {
    value: checkString(stat.value ?? '', LANDING_LIMITS.statValue, `${label}.value`),
    label: checkString(stat.label ?? '', LANDING_LIMITS.statLabel, `${label}.label`),
  };
}

// An FAQ entry: the question is plain text, the answer takes links and
// emphasis, read as a whole like an item's text.
function checkFaqEntry(entry, label) {
  checkKeys(entry, FAQ_FIELDS, label);
  return {
    question: checkString(entry.question ?? '', LANDING_LIMITS.faqQuestion, `${label}.question`),
    answer: checkInlineText(entry.answer ?? '', LANDING_LIMITS.faqAnswer, `${label}.answer`),
  };
}

function checkCredential(credential, label) {
  checkKeys(credential, CREDENTIAL_FIELDS, label);
  const kind = credential.kind ?? 'certification';
  if (!CREDENTIAL_KINDS.includes(kind)) throw httpError(400, `${label}.kind must be one of ${CREDENTIAL_KINDS.join(', ')}`);
  const out = {
    kind,
    name: checkString(credential.name ?? '', LANDING_LIMITS.credentialName, `${label}.name`),
    issuer: checkString(credential.issuer ?? '', LANDING_LIMITS.credentialIssuer, `${label}.issuer`),
    number: checkString(credential.number ?? '', LANDING_LIMITS.credentialNumber, `${label}.number`),
    issued: checkString(credential.issued ?? '', LANDING_LIMITS.credentialDate, `${label}.issued`),
    expires: checkString(credential.expires ?? '', LANDING_LIMITS.credentialDate, `${label}.expires`),
    url: checkString(credential.url ?? '', LANDING_LIMITS.url, `${label}.url`),
  };
  if (!isAllowedDraftUrl(out.url)) throw httpError(400, `${label}.url must be an http, https, mailto or tel link`);
  return out;
}

// A gallery entry: its image (null while the editor's upload for it is on
// its way) and a caption, both always stored.
function checkGalleryEntry(entry, label, refs) {
  checkKeys(entry, GALLERY_ENTRY_FIELDS, label);
  return {
    image: entry.image == null ? null : checkImageRef(entry.image, `${label}.image`, refs),
    caption: checkString(entry.caption ?? '', LANDING_IMAGE_LIMITS.caption, `${label}.caption`),
  };
}

// One section, with the fields of its kind and nothing else. A section
// without an id (an MCP client adding one) gets a new one.
function checkSection(section, i, refs, ids) {
  const label = `sections[${i}]`;
  if (!isPlainObject(section)) throw httpError(400, `${label} must be an object`);
  if (!SECTION_KINDS.includes(section.kind)) throw httpError(400, `${label}.kind must be one of ${SECTION_KINDS.join(', ')}`);
  checkKeys(section, SECTION_FIELDS[section.kind], label);
  const id = section.id ?? randomUUID();
  if (typeof id !== 'string' || !SECTION_ID.test(id)) throw httpError(400, `${label}.id must be 1-64 letters, digits, - or _`);
  if (ids.has(id)) throw httpError(400, `${label}.id is used by another section`);
  ids.add(id);
  const out = { id, kind: section.kind, title: checkString(section.title ?? '', LANDING_LIMITS.sectionTitle, `${label}.title`) };
  if (checkBoolean(section.hidden ?? false, `${label}.hidden`)) out.hidden = true;
  const column = section.column ?? 'main';
  if (!SECTION_COLUMNS.includes(column)) throw httpError(400, `${label}.column must be one of ${SECTION_COLUMNS.join(', ')}`);
  if (column !== 'main') out.column = column;
  switch (section.kind) {
    case 'text':
      out.body = checkInlineText(section.body ?? '', LANDING_LIMITS.text, `${label}.body`, { paragraphs: true });
      break;
    case 'items':
      out.items = checkList(section.items, LANDING_LIMITS.items, `${label}.items`).map((item, j) => checkItem(item, `${label}.items[${j}]`, refs));
      break;
    case 'links':
      out.links = checkList(section.links, LANDING_LIMITS.links, `${label}.links`).map((link, j) => checkLink(link, `${label}.links[${j}]`));
      break;
    case 'resumes': {
      const seen = new Set();
      out.cards = checkList(section.cards, LANDING_LIMITS.cards, `${label}.cards`).map((card, j) =>
        checkCard(card, `${label}.cards[${j}]`, refs, seen)
      );
      break;
    }
    case 'quotes':
      out.quotes = checkList(section.quotes, LANDING_LIMITS.quotes, `${label}.quotes`).map((quote, j) => checkQuote(quote, `${label}.quotes[${j}]`));
      break;
    case 'experience':
      // The same reference rules as a card's.
      out.resumeId = checkResumeRef(section.resumeId, `${label}.resumeId`, refs);
      out.count = section.count ?? EXPERIENCE_DEFAULTS.count;
      if (!Number.isInteger(out.count) || out.count < 1 || out.count > LANDING_LIMITS.experienceCount) {
        throw httpError(400, `${label}.count must be a whole number from 1 to ${LANDING_LIMITS.experienceCount}`);
      }
      out.showDates = checkBoolean(section.showDates ?? EXPERIENCE_DEFAULTS.showDates, `${label}.showDates`);
      break;
    case 'education':
      // An experience section's rules.
      out.resumeId = checkResumeRef(section.resumeId, `${label}.resumeId`, refs);
      out.count = section.count ?? EDUCATION_DEFAULTS.count;
      if (!Number.isInteger(out.count) || out.count < 1 || out.count > LANDING_LIMITS.educationCount) {
        throw httpError(400, `${label}.count must be a whole number from 1 to ${LANDING_LIMITS.educationCount}`);
      }
      out.showDates = checkBoolean(section.showDates ?? EDUCATION_DEFAULTS.showDates, `${label}.showDates`);
      break;
    case 'skills':
      out.resumeId = checkResumeRef(section.resumeId, `${label}.resumeId`, refs);
      break;
    case 'image':
      out.image = section.image == null ? null : checkImageRef(section.image, `${label}.image`, refs);
      out.caption = checkString(section.caption ?? '', LANDING_IMAGE_LIMITS.caption, `${label}.caption`);
      break;
    case 'stats':
      out.stats = checkList(section.stats, LANDING_LIMITS.stats, `${label}.stats`).map((stat, j) => checkStat(stat, `${label}.stats[${j}]`));
      break;
    case 'faq':
      out.entries = checkList(section.entries, LANDING_LIMITS.faqEntries, `${label}.entries`).map((entry, j) =>
        checkFaqEntry(entry, `${label}.entries[${j}]`)
      );
      break;
    case 'credentials':
      out.credentials = checkList(section.credentials, LANDING_LIMITS.credentials, `${label}.credentials`).map((credential, j) =>
        checkCredential(credential, `${label}.credentials[${j}]`)
      );
      break;
    case 'gallery':
      out.images = checkList(section.images, LANDING_LIMITS.galleryImages, `${label}.images`).map((entry, j) =>
        checkGalleryEntry(entry, `${label}.images[${j}]`, refs)
      );
      break;
    case 'media':
      // Only a link the parser knows, so nothing else is ever embedded; the
      // editor holds a half-typed one back until it reads as one.
      out.url = checkString(section.url ?? '', LANDING_LIMITS.url, `${label}.url`);
      if (out.url.trim() !== '' && !parseMediaUrl(out.url)) {
        throw httpError(400, `${label}.url must be an https link to a YouTube or Vimeo video, or to something on SoundCloud or Spotify`);
      }
      out.caption = checkString(section.caption ?? '', LANDING_LIMITS.mediaCaption, `${label}.caption`);
      if (section.poster != null) out.poster = checkImageRef(section.poster, `${label}.poster`, refs);
      out.transcript = checkString(section.transcript ?? '', LANDING_LIMITS.transcript, `${label}.transcript`);
      break;
  }
  return out;
}

function checkSeo(seo, refs) {
  checkKeys(seo ?? {}, SEO_FIELDS, 'seo');
  const out = {
    title: checkString(seo?.title ?? '', LANDING_LIMITS.seoTitle, 'seo.title'),
    description: checkString(seo?.description ?? '', LANDING_LIMITS.seoDescription, 'seo.description'),
    noindex: seo?.noindex ?? false,
  };
  if (typeof out.noindex !== 'boolean') throw httpError(400, 'seo.noindex must be a boolean');
  if (seo?.image != null) out.image = checkImageRef(seo.image, 'seo.image', refs);
  return out;
}

// A complete, clean draft from `input`; missing fields take their empty
// value, so a client can send only what it has. Strings aren't trimmed:
// the editor saves while someone types. The image ids work like the resume
// ids: a new reference must name a stored image, one in the draft before
// may outlive it (referencedImageIds()).
export function validateLanding(input, { knownResumeIds, previousResumeIds = new Set(), knownImageIds = new Set(), previousImageIds = new Set() }) {
  checkKeys(input, FIELDS, 'landing page');
  const base = emptyLanding();
  const out = {
    headline: checkString(input.headline ?? base.headline, LANDING_LIMITS.headline, 'headline'),
    subheadline: checkString(input.subheadline ?? base.subheadline, LANDING_LIMITS.subheadline, 'subheadline'),
    availability: checkString(input.availability ?? base.availability, LANDING_LIMITS.availability, 'availability'),
    photo: input.photo ?? base.photo,
    photoUrl: checkString(input.photoUrl ?? base.photoUrl, LANDING_LIMITS.photoUrl, 'photoUrl'),
  };
  if (!PHOTO_SOURCES.includes(out.photo)) throw httpError(400, `photo must be one of ${PHOTO_SOURCES.join(', ')}`);
  if (out.photoUrl !== '' && !PHOTO_DATA_URL.test(out.photoUrl)) {
    throw httpError(400, 'photoUrl must be a base64 data: URL of a JPEG, PNG or WebP image');
  }

  const refs = { knownResumeIds, previousResumeIds, knownImageIds, previousImageIds };
  if (input.photoImage != null) out.photoImage = checkImageRef(input.photoImage, 'photoImage', refs);
  out.actions = checkList(input.actions, LANDING_LIMITS.actions, 'actions').map((action, i) => checkAction(action, `actions[${i}]`, refs));
  const ids = new Set();
  out.sections = checkList(input.sections, LANDING_LIMITS.sections, 'sections').map((section, i) => checkSection(section, i, refs, ids));
  out.seo = checkSeo(input.seo, refs);
  out.homeLink = input.homeLink ?? base.homeLink;
  if (typeof out.homeLink !== 'boolean') throw httpError(400, 'homeLink must be a boolean');
  out.homeLinkLabel = checkString(input.homeLinkLabel ?? base.homeLinkLabel, LANDING_LIMITS.homeLinkLabel, 'homeLinkLabel');
  out.template = checkTemplate(input.template ?? base.template);
  out.style = checkStyle(input.style ?? base.style);
  return out;
}

// The MCP tool's merge (like mergeShallow in resumeStore.js): the fields in
// `patch` replace the draft's, `sections` and `actions` as a whole, and a null resets one
// to its empty value. `seo` is merged one level deeper, the way setSite()
// merges `colors`, so a description can be set without restating the
// title, and `style` the same with its palettes one more (mergeStylePatch()).
// The result still goes through validateLanding().
export function mergeLandingPatch(current, patch) {
  if (!isPlainObject(patch)) throw httpError(400, 'landing page must be an object');
  const out = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__') continue;
    if (value === null) delete out[key];
    else if (key === 'seo' && isPlainObject(value)) out.seo = mergeLandingPatch(isPlainObject(current.seo) ? current.seo : {}, value);
    else if (key === 'style' && isPlainObject(value)) out.style = mergeStylePatch(current.style, value);
    else out[key] = value;
  }
  return out;
}

// A phone number as typed as a tel: URL, or '' when it has no digits to
// dial. Mirrors telHref() in client/src/resume/safeUrl.js, which the
// header templates link the phone number with.
export function telUrl(phone) {
  const text = typeof phone === 'string' ? phone.trim() : '';
  // No two quantifiers here can take the same characters, so a long run of
  // spaces can't make the match backtrack for seconds.
  const ext = text.match(/(?:ext\.?|x|#)\s*(\d+)$/i);
  const number = ext ? text.slice(0, ext.index) : text;
  const digits = number.replace(/\D/g, '');
  if (!digits || /[a-z#]/i.test(number)) return '';
  return `tel:${number.startsWith('+') ? '+' : ''}${digits}${ext ? `;ext=${ext[1]}` : ''}`;
}

// A first draft for an install that has never saved one, from the default
// resume's *published* header (never its draft, so nothing unpublished is
// carried over): its name and title, an empty text section to write an
// intro in, its email, phone and links, an "Email me" button when it has
// an email, and a card for it. The header
// isn't validated when it's saved, so only what passes the landing page's
// own rules is taken.
export function initialLanding(defaultResumeId, publishedHeader) {
  const header = isPlainObject(publishedHeader) ? publishedHeader : {};
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  const mailto = typeof header.email === 'string' && header.email.trim() ? `mailto:${header.email.trim()}` : '';
  const contact = [
    { type: 'email', label: text(header.email, LANDING_LIMITS.linkLabel).trim(), url: mailto },
    { type: 'phone', label: text(header.phone, LANDING_LIMITS.linkLabel).trim(), url: telUrl(header.phone) },
  ];
  const links = [...contact, ...(Array.isArray(header.links) ? header.links : [])]
    .filter((link) => isPlainObject(link) && typeof link.url === 'string' && link.url !== '' && link.url.length <= LANDING_LIMITS.url && isSafeUrl(link.url))
    .slice(0, LANDING_LIMITS.links)
    .map((link) => ({
      ...(LINK_TYPES.includes(link.type) ? { type: link.type } : {}),
      label: text(link.label, LANDING_LIMITS.linkLabel),
      url: link.url,
    }));
  return {
    ...emptyLanding(),
    headline: text(header.name, LANDING_LIMITS.headline),
    subheadline: text(header.title, LANDING_LIMITS.subheadline),
    actions: mailto && mailto.length <= LANDING_LIMITS.url && isSafeUrl(mailto) ? [{ type: 'link', label: 'Email me', url: mailto }] : [],
    sections: [
      { id: 'intro', kind: 'text', title: '', body: '' },
      ...(links.length ? [{ id: 'links', kind: 'links', title: '', links }] : []),
      { id: 'resumes', kind: 'resumes', title: '', cards: [{ resumeId: defaultResumeId, label: '', blurb: '', showPdf: false }] },
    ],
  };
}

// What a visitor gets: `landing` (a draft or the published snapshot) with
// its references resolved against `context` at the time of the request,
// not of the publish, so a resume made private, unpublished or deleted
// since drops off at once and a renamed one links to its new slug:
//   context.photoUrl — the default resume's published header photo
//   context.site     — the default resume's published site settings, the
//                      page's `site` unless it has colors of its own
//   context.resumes  — Map of resume id → { href, title, pdfHref, experience,
//                      education, skills } for the resumes a visitor may
//                      see (public and published); pdfHref is '' while the
//                      resume has no rendered PDF, experience is
//                      experienceRoles() of its published blocks, education
//                      educationEntries() and skills skillGroups() of them
//   context.images   — Map of image id → { src, width, height } for the
//                      stored images (issue #92), `src` where a visitor
//                      fetches it
//   context.today    — 'YYYY-MM-DD', what a credential's expiry is read
//                      against (dateText.js); today in UTC when not given
// Cards and actions carry no resume ids and never a resume's internal name:
// a card with no label of its own uses the resume's published header title.
// A card's `pdfHref` is there only when it asks for one and the PDF exists;
// a resume action is left out unless its resume (and for `open: 'pdf'`, its
// PDF) is there, a link action unless its URL is safe. Each resolved action
// is { label, href }. A section
// left with nothing to show (no text, no item, every link half typed, every
// card's resume hidden, every quote empty, no stat with a value, no FAQ
// entry with both a question and an answer) is left out, title and all, and
// so is a hidden one; sections lose their ids, and keep `column` when set
// (a divider always goes along: whether it has anything to divide depends
// on how the template arranges the sections, so the client decides, in
// client/src/landing/dividers.js). An experience section
// resolves to { roles, href }: its resume's first `count` roles, and that
// resume's link for "Full resume". An education section resolves the same
// way to { entries, href }, and a skills section to { groups, href }, every
// skill group of its resume. A credential without a name is left out, and
// so is one whose `expires` has passed (hasPassed()), at the time of the
// request, so a lapsed one leaves the page without a republish; one whose
// date can't be read stays, the date shown as written.
// `seo` goes along whole (everything in it ends up in the page's head and
// its X-Robots-Tag anyway), its image resolved like the others. An image
// reference resolves to { src, alt, width, height }, or is left out (a
// photo, a thumbnail, the share image) when its image is gone; an image
// section without one is left out, and so is a gallery entry, then a
// gallery with no entry left. A media section resolves to { media,
// caption, transcript, poster? }: `media` is parseMediaUrl()'s reading of
// its link, never the link itself, and one whose link doesn't read (none
// yet) is left out. An uploaded hero photo is `photoUrl`
// (its src), with its alt as `photoAlt`. Its look (landingStyle.js) is
// `template` (an id the client may not know, and then draws as classic),
// `site` (context.site, or the page's own colors and fonts in the site
// settings' shape) and `darkColors` (its dark palette, or null).
export function resolveLanding(landing, context) {
  const upload = landing.photo === 'upload' ? resolveImage(landing.photoImage, context.images) : null;
  const photoUrl =
    landing.photo === 'custom' ? landing.photoUrl : landing.photo === 'resume' ? context.photoUrl || '' : (upload?.src ?? '');
  const { image: shareImage, ...seo } = landing.seo ?? {};
  const seoImage = resolveImage(shareImage, context.images);
  return {
    headline: landing.headline,
    subheadline: landing.subheadline,
    availability: landing.availability ?? '',
    actions: (landing.actions ?? []).flatMap((action) => {
      const shown = resolveAction(action, context);
      return shown ? [shown] : [];
    }),
    photoUrl,
    ...(upload ? { photoAlt: upload.alt } : {}),
    sections: landing.sections.flatMap((section) => {
      const shown = section.hidden ? null : resolveSection(section, context);
      return shown ? [{ kind: section.kind, title: section.title, ...(section.column ? { column: section.column } : {}), ...shown }] : [];
    }),
    seo: { ...emptySeo(), ...seo, ...(seoImage ? { image: seoImage } : {}) },
    template: landing.template || DEFAULT_LANDING_TEMPLATE,
    site: landingSite(landing.style, context.site),
    darkColors: darkPalette(landing.style),
  };
}

// What a button without a label of its own says.
const ACTION_LABELS = { page: 'View my resume', pdf: 'Download my resume (PDF)' };

function resolveAction(action, context) {
  const icon = action.icon ? { icon: action.icon } : {};
  if (action.type === 'link') {
    return action.url !== '' && isSafeUrl(action.url) ? { label: action.label || action.url, href: action.url, ...icon } : null;
  }
  const target = context.resumes.get(action.resumeId);
  const href = action.open === 'pdf' ? target?.pdfHref : target?.href;
  return href ? { label: action.label || ACTION_LABELS[action.open], href, ...icon } : null;
}

function resolveSection(section, context) {
  switch (section.kind) {
    case 'text':
      return section.body.trim() ? { body: section.body } : null;
    case 'items': {
      const items = section.items
        .filter((item) => item.title.trim() || item.text.trim())
        .map((item) => {
          const image = resolveImage(item.image, context.images);
          return {
            title: item.title,
            text: item.text,
            url: item.url !== '' && isSafeUrl(item.url) ? item.url : '',
            ...(item.meta?.trim() ? { meta: item.meta } : {}),
            ...(image ? { image } : {}),
          };
        });
      return items.length ? { items } : null;
    }
    case 'links': {
      const links = section.links
        .filter((link) => link.url !== '' && isSafeUrl(link.url))
        .map((link) => ({ ...(link.type ? { type: link.type } : {}), label: link.label || link.url, url: link.url }));
      return links.length ? { links } : null;
    }
    case 'resumes': {
      const cards = section.cards.flatMap((card) => {
        const target = context.resumes.get(card.resumeId);
        if (!target) return [];
        const pdfHref = card.showPdf && target.pdfHref ? { pdfHref: target.pdfHref } : {};
        return [{ label: card.label || target.title || 'Resume', blurb: card.blurb, href: target.href, ...pdfHref }];
      });
      return cards.length ? { cards } : null;
    }
    case 'quotes': {
      const quotes = section.quotes
        .filter((quote) => quote.text.trim())
        .map((quote) => ({ text: quote.text, name: quote.name, role: quote.role, url: quote.url !== '' && isSafeUrl(quote.url) ? quote.url : '' }));
      return quotes.length ? { quotes } : null;
    }
    case 'experience': {
      const target = context.resumes.get(section.resumeId);
      const roles = (target?.experience ?? []).slice(0, section.count).map((role) => ({
        jobTitle: role.jobTitle,
        company: role.company,
        companyUrl: role.companyUrl !== '' && isSafeUrl(role.companyUrl) ? role.companyUrl : '',
        location: role.location,
        dates: section.showDates ? roleDates(role) : '',
      }));
      return roles.length ? { roles, href: target.href } : null;
    }
    case 'image': {
      const image = resolveImage(section.image, context.images);
      return image ? { image, caption: section.caption } : null;
    }
    case 'divider':
      return {};
    case 'stats': {
      // A stat is its value; a label alone has nothing to show.
      const stats = section.stats.filter((stat) => stat.value.trim()).map((stat) => ({ value: stat.value, label: stat.label }));
      return stats.length ? { stats } : null;
    }
    case 'faq': {
      // An entry missing its question or its answer has nothing to open.
      const entries = section.entries
        .filter((entry) => entry.question.trim() && entry.answer.trim())
        .map((entry) => ({ question: entry.question, answer: entry.answer }));
      return entries.length ? { entries } : null;
    }
    case 'education': {
      const target = context.resumes.get(section.resumeId);
      const entries = (target?.education ?? []).slice(0, section.count).map((entry) => ({
        degree: entry.degree,
        institution: entry.institution,
        location: entry.location,
        dates: section.showDates ? roleDates(entry) : '',
      }));
      return entries.length ? { entries, href: target.href } : null;
    }
    case 'skills': {
      const target = context.resumes.get(section.resumeId);
      const groups = (target?.skills ?? []).map((group) => ({ category: group.category, items: [...group.items] }));
      return groups.length ? { groups, href: target.href } : null;
    }
    case 'credentials': {
      const today = context.today ?? utcToday();
      const credentials = section.credentials
        .filter((credential) => credential.name.trim() && !hasPassed(credential.expires, today))
        .map((credential) => resolveCredential(credential));
      return credentials.length ? { credentials } : null;
    }
    case 'gallery': {
      const images = section.images.flatMap((entry) => {
        const image = resolveImage(entry.image, context.images);
        return image ? [{ image, caption: entry.caption }] : [];
      });
      return images.length ? { images } : null;
    }
    case 'media': {
      const media = parseMediaUrl(section.url);
      if (!media) return null;
      const poster = resolveImage(section.poster, context.images);
      return { media, caption: section.caption, transcript: section.transcript, ...(poster ? { poster } : {}) };
    }
    default:
      return null;
  }
}

function resolveCredential(credential) {
  const { kind, name, issuer, number, issued, expires, url } = credential;
  return { kind, name, issuer, number, issued, expires, url: url !== '' && isSafeUrl(url) ? url : '' };
}

function roleDates({ startDate, endDate }) {
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate;
}

const roleText = (value) => (typeof value === 'string' ? value.trim() : '');

// The roles an experience section may show from a resume's published
// `blocks`: its experience blocks shown on the web (publicBlocks.js's
// filter), in the snapshot's order, with only what the section shows (never
// a description or a bullet), and no more than a section can ask for. One
// with neither a title nor a company has nothing to show and is skipped.
export function experienceRoles(blocks) {
  return blocksForMode(Array.isArray(blocks) ? blocks : [], 'web')
    .filter((block) => block.type === 'experience' && !block.hidden)
    .map((block) => {
      const data = isPlainObject(block.data) ? block.data : {};
      return {
        jobTitle: roleText(data.jobTitle),
        company: roleText(data.company),
        companyUrl: roleText(data.companyUrl),
        location: roleText(data.location),
        startDate: roleText(data.startDate),
        endDate: roleText(data.endDate),
      };
    })
    .filter((role) => role.jobTitle || role.company)
    .slice(0, LANDING_LIMITS.experienceCount);
}

// The entries an education section may show from a resume's published
// `blocks`, read like experienceRoles(): its education blocks shown on the
// web, in order, with only degree, institution, location and dates. One
// with neither a degree nor an institution is skipped.
export function educationEntries(blocks) {
  return blocksForMode(Array.isArray(blocks) ? blocks : [], 'web')
    .filter((block) => block.type === 'education' && !block.hidden)
    .map((block) => {
      const data = isPlainObject(block.data) ? block.data : {};
      return {
        degree: roleText(data.degree),
        institution: roleText(data.institution),
        location: roleText(data.location),
        startDate: roleText(data.startDate),
        endDate: roleText(data.endDate),
      };
    })
    .filter((entry) => entry.degree || entry.institution)
    .slice(0, LANDING_LIMITS.educationCount);
}

// A skill group's `items` as the resume draws them as chips: split on
// commas, trimmed, blanks dropped. Mirrors splitItems() in
// client/src/resume/skillItems.js (resolveLanding.test.js compares them).
export function splitSkillItems(items) {
  return (typeof items === 'string' ? items : '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

// The groups a skills section shows from a resume's published `blocks`:
// its skills_group blocks shown on the web, in order, with only the
// category and its items (splitSkillItems()). One with no items is skipped.
export function skillGroups(blocks) {
  return blocksForMode(Array.isArray(blocks) ? blocks : [], 'web')
    .filter((block) => block.type === 'skills_group' && !block.hidden)
    .map((block) => {
      const data = isPlainObject(block.data) ? block.data : {};
      return { category: roleText(data.category), items: splitSkillItems(data.items) };
    })
    .filter((group) => group.items.length > 0);
}
