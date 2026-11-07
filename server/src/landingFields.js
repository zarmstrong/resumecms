import { httpError } from './httpError.js';

// The optional landing page at `/` (issue #70): a short home page with a
// headline, an intro, a photo, links and cards for some of the resumes. Pure
// validation and shaping here; landingStore.js stores it and decides which
// hosts get it.
//
// The draft is a fixed set of fields, all always present once stored:
//   { headline, subheadline, intro, photo, photoUrl, links, resumes }
// `photo` says where the photo comes from: 'resume' (the default resume's
// published header photo), 'custom' (photoUrl) or 'none'. `resumes` is the
// cards, in order: { resumeId, label, blurb }.
//
// Everything here ends up in front of every visitor, so it's checked more
// strictly than the header: unknown keys, wrong types and oversized values
// are a 400 on save, links can't use a script-running scheme, and the photo
// can only be an inline image. resolveLanding() is the only shape that may
// leave the server publicly.

export const LANDING_LIMITS = {
  headline: 120,
  subheadline: 200,
  intro: 4000,
  links: 12,
  linkLabel: 100,
  url: 2048,
  resumes: 12,
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

const FIELDS = ['headline', 'subheadline', 'intro', 'photo', 'photoUrl', 'links', 'resumes'];
const LINK_FIELDS = ['type', 'label', 'url'];
const CARD_FIELDS = ['resumeId', 'label', 'blurb'];

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];
const PHOTO_DATA_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function emptyLanding() {
  return { headline: '', subheadline: '', intro: '', photo: 'resume', photoUrl: '', links: [], resumes: [] };
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

function checkLink(link, i) {
  const label = `links[${i}]`;
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

function checkCard(card, i, { knownResumeIds, previousResumeIds }, seen) {
  const label = `resumes[${i}]`;
  checkKeys(card, CARD_FIELDS, label);
  const resumeId = checkString(card.resumeId, 200, `${label}.resumeId`);
  if (seen.has(resumeId)) throw httpError(400, `${label}: that resume already has a card`);
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

// A complete, clean draft from `input`; missing fields take their empty
// value, so a client can send only what it has. Strings aren't trimmed:
// the editor saves while someone types.
export function validateLanding(input, { knownResumeIds, previousResumeIds = new Set() }) {
  checkKeys(input, FIELDS, 'landing page');
  const base = emptyLanding();
  const out = {
    headline: checkString(input.headline ?? base.headline, LANDING_LIMITS.headline, 'headline'),
    subheadline: checkString(input.subheadline ?? base.subheadline, LANDING_LIMITS.subheadline, 'subheadline'),
    intro: checkString(input.intro ?? base.intro, LANDING_LIMITS.intro, 'intro'),
    photo: input.photo ?? base.photo,
    photoUrl: checkString(input.photoUrl ?? base.photoUrl, LANDING_LIMITS.photoUrl, 'photoUrl'),
  };
  if (!PHOTO_SOURCES.includes(out.photo)) throw httpError(400, `photo must be one of ${PHOTO_SOURCES.join(', ')}`);
  if (out.photoUrl !== '' && !PHOTO_DATA_URL.test(out.photoUrl)) {
    throw httpError(400, 'photoUrl must be a base64 data: URL of a JPEG, PNG or WebP image');
  }

  const links = input.links ?? base.links;
  if (!Array.isArray(links)) throw httpError(400, 'links must be an array');
  if (links.length > LANDING_LIMITS.links) throw httpError(400, `At most ${LANDING_LIMITS.links} links`);
  out.links = links.map(checkLink);

  const cards = input.resumes ?? base.resumes;
  if (!Array.isArray(cards)) throw httpError(400, 'resumes must be an array');
  if (cards.length > LANDING_LIMITS.resumes) throw httpError(400, `At most ${LANDING_LIMITS.resumes} resume cards`);
  const seen = new Set();
  out.resumes = cards.map((card, i) => checkCard(card, i, { knownResumeIds, previousResumeIds }, seen));
  return out;
}

// The MCP tool's merge (like mergeShallow in resumeStore.js): the fields in
// `patch` replace the draft's, a list as a whole, and a null resets one to
// its empty value. The result still goes through validateLanding().
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
// carried over): its name, title and links, and a card for it. The header
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
    links,
    resumes: [{ resumeId: defaultResumeId, label: '', blurb: '' }],
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
// no label of its own uses the resume's published header title.
export function resolveLanding(landing, context) {
  const photoUrl = landing.photo === 'custom' ? landing.photoUrl : landing.photo === 'resume' ? context.photoUrl || '' : '';
  return {
    headline: landing.headline,
    subheadline: landing.subheadline,
    intro: landing.intro,
    photoUrl,
    links: landing.links
      .filter((link) => link.url !== '' && isSafeUrl(link.url))
      .map((link) => ({ ...(link.type ? { type: link.type } : {}), label: link.label || link.url, url: link.url })),
    resumes: landing.resumes.flatMap((card) => {
      const target = context.resumes.get(card.resumeId);
      if (!target) return [];
      return [{ label: card.label || target.title || 'Resume', blurb: card.blurb, href: target.href }];
    }),
    site: context.site ?? null,
  };
}
