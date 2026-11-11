import { httpError } from './httpError.js';
import { parseMediaUrl } from './mediaUrl.js';

// The landing page's images (issue #92), the pure half: the caps, how an
// upload's type is told, and how the page refers to an image. The bytes
// live in the `landing_images` table (landingImageStore.js), re-encoded on
// upload (imageUpload.js), so the draft only carries a reference:
//   { imageId, alt }
// `imageId` is the sha256 (hex) of the stored bytes; `alt` is required (a
// string; '' while someone is still typing it). A new reference must name a
// stored image; one already in the draft may outlive its image, as a card
// may outlive its resume, and then shows nothing. Where they're used: the
// hero (`photo: 'upload'` with `photoImage`), an item's `image` (a
// thumbnail), an `image` section, a `gallery` section's entries (issue
// #120), a `media` section's `poster` (issue #121), and `seo.image` (the
// link-preview image).

export const LANDING_IMAGE_LIMITS = {
  // What the editor may send. Everything is re-encoded, so this only bounds
  // the work: a phone photo fits.
  uploadBytes: 15 * 1024 * 1024,
  // An MCP client sends base64 inside the JSON-RPC body, which routes/mcp.js
  // caps at 2 MB.
  mcpUploadBytes: 1_400_000,
  // Larger images are scaled down to this on their long side.
  longSide: 1600,
  // A decompression bomb is turned away before it's decoded (50 MP).
  inputPixels: 50_000_000,
  // After the re-encode, per image and for the whole store.
  storedBytes: 1.5 * 1024 * 1024,
  // Room for a few full galleries (24 images each, issue #120) besides the
  // hero, thumbnails and image sections, and for the images a draft has
  // replaced but the snapshot still shows. They live in SQLite and every
  // backup copies them, so not much more than that.
  count: 100,
  totalBytes: 60 * 1024 * 1024,
  alt: 200,
  // An image section's caption, and a gallery entry's.
  caption: 300,
};

// An image nothing references is deleted (after a publish, and on boot)
// only once it's this old, so an upload made just before a discard, or not
// yet saved into the draft, isn't lost.
export const IMAGE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

// Where a visitor fetches an image (only while the shown page shows it,
// see the store's publicLandingImage()), and where the editor's preview
// does (any stored image, behind login).
export const PUBLIC_IMAGE_PATH = '/api/public/landing/images/';
export const EDITOR_IMAGE_PATH = '/api/landing/images/';

const IMAGE_ID = /^[0-9a-f]{64}$/;
const REF_FIELDS = ['imageId', 'alt'];

export function isImageId(value) {
  return typeof value === 'string' && IMAGE_ID.test(value);
}

// The type an upload really is, from its first bytes: 'image/jpeg',
// 'image/png' or 'image/webp', else null. The declared Content-Type is
// never trusted.
export function sniffImageType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// One reference, checked: `refs` is { knownImageIds, previousImageIds },
// the stored images and the ones the draft already names.
export function checkImageRef(ref, label, { knownImageIds = new Set(), previousImageIds = new Set() } = {}) {
  if (!isPlainObject(ref)) throw httpError(400, `${label} must be an object with imageId and alt`);
  const unknown = Object.keys(ref).find((key) => !REF_FIELDS.includes(key));
  if (unknown !== undefined) throw httpError(400, `Unknown ${label} field: ${unknown}`);
  if (!isImageId(ref.imageId)) throw httpError(400, `${label}.imageId must be an uploaded image's id`);
  if (!knownImageIds.has(ref.imageId) && !previousImageIds.has(ref.imageId)) {
    throw httpError(400, `${label}.imageId does not reference a stored image`);
  }
  if (typeof ref.alt !== 'string') throw httpError(400, `${label}.alt is required (a string describing the image)`);
  if (ref.alt.length > LANDING_IMAGE_LIMITS.alt) throw httpError(400, `${label}.alt is too long (at most ${LANDING_IMAGE_LIMITS.alt} characters)`);
  return { imageId: ref.imageId, alt: ref.alt };
}

// Every image `landing` (a draft or snapshot) names, used or not: the
// hero's even while another photo source is picked, so switching back
// still finds it.
export function referencedImageIds(landing) {
  const refs = [
    landing?.photoImage,
    landing?.seo?.image,
    ...(Array.isArray(landing?.sections) ? landing.sections : []).flatMap((section) =>
      section?.kind === 'image' ? [section.image] : section?.kind === 'items' && Array.isArray(section.items) ? section.items.map((item) => item?.image) : []
    ),
    ...(Array.isArray(landing?.sections) ? landing.sections : []).flatMap((section) =>
      section?.kind === 'gallery' && Array.isArray(section.images) ? section.images.map((entry) => entry?.image) : []
    ),
    ...(Array.isArray(landing?.sections) ? landing.sections : []).flatMap((section) => (section?.kind === 'media' ? [section.poster] : [])),
  ];
  return new Set(refs.filter((ref) => isPlainObject(ref) && isImageId(ref.imageId)).map((ref) => ref.imageId));
}

// Throws a 400 unless every image reference the published page would show
// has a description: `alt` is required, and only allowed to be blank in a
// draft because the editor saves while it's typed. "Shown" as
// resolveLanding() decides: nothing in a hidden section, the hero's only
// with photo: 'upload', an item's only on an item with a title or text,
// every gallery entry's, a media section's poster only while its link
// reads as one (parseMediaUrl()), and only a reference whose image is among `storedIds` (one whose image
// is gone shows nothing).
export function assertImagesDescribed(landing, storedIds) {
  const missing = [];
  const check = (ref, field, where) => {
    if (isPlainObject(ref) && storedIds.has(ref.imageId) && !(typeof ref.alt === 'string' && ref.alt.trim())) missing.push({ field, where });
  };
  if (landing?.photo === 'upload') check(landing.photoImage, 'photoImage.alt', 'the photo');
  (Array.isArray(landing?.sections) ? landing.sections : []).forEach((section, i) => {
    if (section?.hidden) return;
    if (section?.kind === 'image') check(section.image, `sections[${i}].image.alt`, `the image in section ${i + 1}`);
    if (section?.kind === 'items' && Array.isArray(section.items)) {
      section.items.forEach((item, j) => {
        if (item?.title?.trim() || item?.text?.trim()) {
          check(item.image, `sections[${i}].items[${j}].image.alt`, `the thumbnail of item ${j + 1} in section ${i + 1}`);
        }
      });
    }
    if (section?.kind === 'gallery' && Array.isArray(section.images)) {
      section.images.forEach((entry, j) => {
        check(entry?.image, `sections[${i}].images[${j}].image.alt`, `image ${j + 1} of the gallery in section ${i + 1}`);
      });
    }
    if (section?.kind === 'media' && parseMediaUrl(section.url)) check(section.poster, `sections[${i}].poster.alt`, `the poster in section ${i + 1}`);
  });
  check(landing?.seo?.image, 'seo.image.alt', 'the share image');
  if (missing.length) {
    const [first] = missing;
    const more = missing.length > 1 ? ` (and ${missing.length - 1} more)` : '';
    throw httpError(400, `Describe every image before publishing: ${first.where} has no description (${first.field})${more}.`);
  }
}

// A reference as a visitor sees it, { src, alt, width, height }, or null
// when it names no stored image. `images` is a Map of id →
// { src, width, height } (resolveLanding()'s context.images).
export function resolveImage(ref, images) {
  const image = isPlainObject(ref) ? images?.get(ref.imageId) : null;
  return image ? { src: image.src, alt: typeof ref.alt === 'string' ? ref.alt : '', width: image.width, height: image.height } : null;
}

// The id in a public image path, else null.
export function imageIdOfPath(src) {
  if (typeof src !== 'string' || !src.startsWith(PUBLIC_IMAGE_PATH)) return null;
  const id = src.slice(PUBLIC_IMAGE_PATH.length);
  return isImageId(id) ? id : null;
}

// Every image the resolved page (resolveLanding()'s shape) shows, by id:
// what /api/public/landing/images/:id may serve.
export function shownImageIds(resolved) {
  const srcs = [
    resolved?.photoUrl,
    resolved?.seo?.image?.src,
    ...(resolved?.sections ?? []).flatMap((section) =>
      section.kind === 'image' ? [section.image?.src] : section.kind === 'items' ? section.items.map((item) => item.image?.src) : []
    ),
    ...(resolved?.sections ?? []).flatMap((section) => (section.kind === 'gallery' ? section.images.map((entry) => entry.image?.src) : [])),
    ...(resolved?.sections ?? []).flatMap((section) => (section.kind === 'media' ? [section.poster?.src] : [])),
  ];
  return new Set(srcs.map(imageIdOfPath).filter(Boolean));
}
