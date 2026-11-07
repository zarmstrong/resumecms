import { randomUUID } from 'node:crypto';
import { httpError } from './httpError.js';

// The optional landing page at `/` (issue #70): a short home page with a
// headline, a photo and a list of sections. Pure validation and shaping
// here; landingStore.js stores it and decides which hosts get it.
//
// The draft is a fixed set of fields, all always present once stored:
//   { headline, subheadline, photo, photoUrl, sections }
// `photo` says where the photo comes from: 'resume' (the default resume's
// published header photo), 'custom' (photoUrl) or 'none'. `sections` is
// shown in order under the headline, each `{ id, kind, title, ... }` with
// the fields of its kind (SECTION_FIELDS):
//   text    — body: plain text, a blank line between paragraphs
//   items   — items: [{ title, text, url }], e.g. projects
//   links   — links: [{ type, label, url }]
//   resumes — cards: [{ resumeId, label, blurb }] linking to resumes
// `id` only tells sections apart in the editor; it never leaves the server
// publicly. A draft stored before sections existed is read through
// upgradeLanding().
//
// Everything here ends up in front of every visitor, so it's checked more
// strictly than the header: unknown keys, wrong types and oversized values
// are a 400 on save, links can't use a script-running scheme, and the photo
// can only be an inline image. resolveLanding() is the only shape that may
// leave the server publicly.

export const LANDING_LIMITS = {
  headline: 120,
  subheadline: 200,
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
  // About 512 KB of image once base64-decoded; the editor's cropper makes
  // a 480 px JPEG of well under that.
  photoUrl: 700_000,
};

export const PHOTO_SOURCES = ['resume', 'custom', 'none'];

// The header's link types (client/src/resume/linkTypes.js), which only pick
// the badge a link is drawn with.
export const LINK_TYPES = ['linkedin', 'github', 'gitlab', 'website', 'twitter', 'stackoverflow', 'medium', 'youtube', 'custom'];

export const SECTION_KINDS = ['text', 'items', 'links', 'resumes'];

const FIELDS = ['headline', 'subheadline', 'photo', 'photoUrl', 'sections'];
const SECTION_FIELDS = {
  text: ['id', 'kind', 'title', 'body'],
  items: ['id', 'kind', 'title', 'items'],
  links: ['id', 'kind', 'title', 'links'],
  resumes: ['id', 'kind', 'title', 'cards'],
};
const ITEM_FIELDS = ['title', 'text', 'url'];
const LINK_FIELDS = ['type', 'label', 'url'];
const CARD_FIELDS = ['resumeId', 'label', 'blurb'];
const SECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];
const PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function emptyLanding() {
  return { headline: '', subheadline: '', photo: 'resume', photoUrl: '', sections: [] };
}

// A draft or snapshot as stored before sections (issue #70's first shape:
// `intro`, `links` and `resumes` as fields of their own), turned into the
// sections it showed, in the order it showed them. The ids are fixed, so
// reading the same stored draft twice gives the same sections.
export function upgradeLanding(stored) {
  if (!isPlainObject(stored) || Array.isArray(stored.sections)) return stored;
  const { intro, links, resumes, ...rest } = stored;
  const sections = [];
  if (typeof intro === 'string' && intro !== '') sections.push({ id: 'intro', kind: 'text', title: '', body: intro });
  if (Array.isArray(links) && links.length) sections.push({ id: 'links', kind: 'links', title: '', links });
  if (Array.isArray(resumes) && resumes.length) sections.push({ id: 'resumes', kind: 'resumes', title: '', cards: resumes });
  return { ...rest, sections };
}

// Every resume a card in `landing` names, in any section.
export function cardResumeIds(landing) {
  return new Set(
    (landing.sections || []).flatMap((section) => (section.kind === 'resumes' ? section.cards.map((card) => card.resumeId) : []))
  );
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
  if (!isAllowedDraftUrl(out.url)) throw httpError(400, `${label}.url must be an http, https or mailto link`);
  return out;
}

function checkCard(card, label, { knownResumeIds, previousResumeIds }, seen) {
  checkKeys(card, CARD_FIELDS, label);
  const resumeId = checkString(card.resumeId, 200, `${label}.resumeId`);
  if (seen.has(resumeId)) throw httpError(400, `${label}: that resume already has a card in this section`);
  seen.add(resumeId);
  // A card already in the draft keeps its place even if its resume has
  // since been deleted (the editor would otherwise be unable to save
  // anything until it's removed; nothing shows it publicly). A new one
  // has to name a resume that exists.
  if (!knownResumeIds.has(resumeId) && !previousResumeIds.has(resumeId)) {
    throw httpError(400, `${label}.resumeId does not reference an existing resume`);
  }
  return {
    resumeId,
    label: checkString(card.label ?? '', LANDING_LIMITS.cardLabel, `${label}.label`),
    blurb: checkString(card.blurb ?? '', LANDING_LIMITS.blurb, `${label}.blurb`),
  };
}

function checkList(value, max, label) {
  const list = value ?? [];
  if (!Array.isArray(list)) throw httpError(400, `${label} must be an array`);
  if (list.length > max) throw httpError(400, `${label}: at most ${max}`);
  return list;
}

function checkItem(item, label) {
  checkKeys(item, ITEM_FIELDS, label);
  const out = {
    title: checkString(item.title ?? '', LANDING_LIMITS.itemTitle, `${label}.title`),
    text: checkString(item.text ?? '', LANDING_LIMITS.itemText, `${label}.text`),
    url: checkString(item.url ?? '', LANDING_LIMITS.url, `${label}.url`),
  };
  if (!isAllowedDraftUrl(out.url)) throw httpError(400, `${label}.url must be an http, https or mailto link`);
  return out;
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
  switch (section.kind) {
    case 'text':
      out.body = checkString(section.body ?? '', LANDING_LIMITS.text, `${label}.body`);
      break;
    case 'items':
      out.items = checkList(section.items, LANDING_LIMITS.items, `${label}.items`).map((item, j) => checkItem(item, `${label}.items[${j}]`));
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
  }
  return out;
}

// A complete, clean draft from `input`; missing fields take their empty
// value, so a client can send only what it has. Strings aren't trimmed:
// the editor saves while someone types.
export function validateLanding(input, { knownResumeIds, previousResumeIds = new Set() }) {
  checkKeys(input, FIELDS, 'landing page');
  const base = emptyLanding();
  const out = {
    headline: checkString(input.headline ?? base.headline, LANDING_LIMITS.headline, 'headline'),
    subheadline: checkString(input.subheadline ?? base.subheadline, LANDING_LIMITS.subheadline, 'subheadline'),
    photo: input.photo ?? base.photo,
    photoUrl: checkString(input.photoUrl ?? base.photoUrl, LANDING_LIMITS.photoUrl, 'photoUrl'),
  };
  if (!PHOTO_SOURCES.includes(out.photo)) throw httpError(400, `photo must be one of ${PHOTO_SOURCES.join(', ')}`);
  if (out.photoUrl !== '' && !PHOTO_DATA_URL.test(out.photoUrl)) {
    throw httpError(400, 'photoUrl must be a base64 data: URL of a JPEG, PNG or WebP image');
  }

  const ids = new Set();
  out.sections = checkList(input.sections, LANDING_LIMITS.sections, 'sections').map((section, i) =>
    checkSection(section, i, { knownResumeIds, previousResumeIds }, ids)
  );
  return out;
}

// The MCP tool's merge (like mergeShallow in resumeStore.js): the fields in
// `patch` replace the draft's, `sections` as a whole, and a null resets one
// to its empty value. The result still goes through validateLanding().
export function mergeLandingPatch(current, patch) {
  if (!isPlainObject(patch)) throw httpError(400, 'landing page must be an object');
  const out = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__') continue;
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

// A first draft for an install that has never saved one, from the default
// resume's *published* header (never its draft, so nothing unpublished is
// carried over): its name and title, an empty text section to write an
// intro in, its links, and a card for it. The header
// isn't validated when it's saved, so only what passes the landing page's
// own rules is taken.
export function initialLanding(defaultResumeId, publishedHeader) {
  const header = isPlainObject(publishedHeader) ? publishedHeader : {};
  const text = (value, max) => (typeof value === 'string' ? value.slice(0, max) : '');
  const links = (Array.isArray(header.links) ? header.links : [])
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
    sections: [
      { id: 'intro', kind: 'text', title: '', body: '' },
      ...(links.length ? [{ id: 'links', kind: 'links', title: '', links }] : []),
      { id: 'resumes', kind: 'resumes', title: '', cards: [{ resumeId: defaultResumeId, label: '', blurb: '' }] },
    ],
  };
}

// What a visitor gets: `landing` (a draft or the published snapshot) with
// its references resolved against `context` at the time of the request,
// not of the publish, so a resume made private, unpublished or deleted
// since drops off at once and a renamed one links to its new slug:
//   context.photoUrl — the default resume's published header photo
//   context.site     — the default resume's published site settings
//   context.resumes  — Map of resume id → { href, title } for the resumes a
//                      visitor may see (public and published)
// Cards carry no resume ids and never a resume's internal name: a card with
// no label of its own uses the resume's published header title. A section
// left with nothing to show (no text, no item, every link half typed, every
// card's resume hidden) is left out, title and all; sections lose their ids.
export function resolveLanding(landing, context) {
  const photoUrl = landing.photo === 'custom' ? landing.photoUrl : landing.photo === 'resume' ? context.photoUrl || '' : '';
  return {
    headline: landing.headline,
    subheadline: landing.subheadline,
    photoUrl,
    sections: landing.sections.flatMap((section) => {
      const shown = resolveSection(section, context);
      return shown ? [{ kind: section.kind, title: section.title, ...shown }] : [];
    }),
    site: context.site ?? null,
  };
}

function resolveSection(section, context) {
  switch (section.kind) {
    case 'text':
      return section.body.trim() ? { body: section.body } : null;
    case 'items': {
      const items = section.items
        .filter((item) => item.title.trim() || item.text.trim())
        .map((item) => ({ title: item.title, text: item.text, url: item.url !== '' && isSafeUrl(item.url) ? item.url : '' }));
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
        return [{ label: card.label || target.title || 'Resume', blurb: card.blurb, href: target.href }];
      });
      return cards.length ? { cards } : null;
    }
    default:
      return null;
  }
}
