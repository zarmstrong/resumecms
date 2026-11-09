import { createHash } from 'node:crypto';
import { imageIdOfPath } from './landingImageFields.js';

// The images a link preview shows (issue #87): a page's photo, served from
// the data: URL it's stored as, and its share card, a 1200×630 PNG of the
// name, title and photo that the PDF renderer draws from /print/card. Pure;
// shareStore.js stores the cards and decides which images are public.
//
// Both are addressed by a hash of what they show, so a new photo or a
// renamed title is a new URL that no cache (LinkedIn's included) has seen,
// and an image only answers while something public still shows it.

// The photo formats link-preview crawlers read. The header's photo comes
// from the editor's cropper (a JPEG), the landing page's is checked on save
// (landingFields.js); anything else is treated as no photo.
const PHOTO_DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/;

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

// Bump when the card's design (client/src/share/ShareCard.jsx) changes, so
// every card is drawn again instead of the old design being kept for as
// long as its content stays the same.
export const CARD_DESIGN_VERSION = 1;

const NAME_MAX = 120;
const TITLE_MAX = 200;

function hash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

// `{ contentType, body }` for a usable photo data: URL, else null.
export function parsePhoto(photoUrl) {
  const match = typeof photoUrl === 'string' ? PHOTO_DATA_URL.exec(photoUrl) : null;
  if (!match) return null;
  const body = Buffer.from(match[2], 'base64');
  return body.length ? { contentType: match[1], body } : null;
}

export function photoKey(photoUrl) {
  return parsePhoto(photoUrl) ? `p${hash(photoUrl)}` : null;
}

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

// What a card shows, and all it's drawn from: the name and title, the
// photo (a data: URL, or the landing page's uploaded photo by its public
// path, which the renderer fetches like a visitor would), and the parts of the site settings the card uses (its colors and
// fonts), so a layout change doesn't draw it again. Null when there's no
// name to show.
export function cardContent({ name, title, photoUrl, site }) {
  const shownName = text(name, NAME_MAX);
  if (!shownName) return null;
  const s = site && typeof site === 'object' ? site : {};
  return {
    name: shownName,
    title: text(title, TITLE_MAX),
    photoUrl: parsePhoto(photoUrl) || imageIdOfPath(photoUrl) ? photoUrl : '',
    site: {
      colors: s.colors && typeof s.colors === 'object' ? s.colors : {},
      accent: typeof s.accent === 'string' ? s.accent : '',
      font: typeof s.font === 'string' ? s.font : '',
      nameFont: typeof s.nameFont === 'string' ? s.nameFont : '',
    },
  };
}

export function cardKey(content) {
  return content ? `c${hash(`${CARD_DESIGN_VERSION}\n${JSON.stringify(content)}`)}` : null;
}

// A key as it appears in /api/public/images/<key>: `p` or `c` and 32 hex
// digits, nothing that could step out of the cards directory.
export function isImageKey(value) {
  return typeof value === 'string' && /^[pc][0-9a-f]{32}$/.test(value);
}
