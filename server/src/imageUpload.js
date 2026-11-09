import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { httpError } from './httpError.js';
import { LANDING_IMAGE_LIMITS, sniffImageType } from './landingImageFields.js';

// An uploaded image re-encoded for the landing page (issue #92). Every
// upload is decoded and encoded again, whoever sent it (the editor, curl,
// an MCP client), which is what keeps the camera's EXIF (GPS position
// included), XMP, comments and text chunks off the public page: sharp
// writes no metadata unless asked to. On the way it applies the EXIF
// orientation, scales the image down to LANDING_IMAGE_LIMITS.longSide, and
// keeps only the first frame of an animation. With faviconRaster.js, the
// only module that loads sharp, so nothing else (the client's tests import
// some server modules) pulls in the native binary.
//
// Resolves with { id, mime, width, height, bytes }, `id` the sha256 of
// `bytes`; rejects with a 400 (not a JPEG, PNG or WebP, or unreadable) or
// a 413 (too big even after the re-encode). The caps are options for the
// MCP tool's smaller one, and for tests.
export async function reencodeImage(
  input,
  { maxInputBytes = LANDING_IMAGE_LIMITS.uploadBytes, maxStoredBytes = LANDING_IMAGE_LIMITS.storedBytes } = {}
) {
  if (!Buffer.isBuffer(input) || input.length === 0) throw httpError(400, 'Send the image file as the request body');
  if (input.length > maxInputBytes) throw httpError(413, `That image is too large (at most ${megabytes(maxInputBytes)} MB)`);
  const mime = sniffImageType(input);
  if (!mime) throw httpError(400, 'Only JPEG, PNG and WebP images can be uploaded');

  let out = await encode(input, mime);
  // A large PNG photo is far smaller as WebP, which keeps its transparency.
  if (out.bytes.length > maxStoredBytes && mime === 'image/png') out = await encode(input, 'image/webp');
  if (out.bytes.length > maxStoredBytes) {
    throw httpError(413, `That image is still over ${megabytes(maxStoredBytes)} MB once resized; try a smaller or simpler one`);
  }
  return { id: createHash('sha256').update(out.bytes).digest('hex'), ...out };
}

const ENCODERS = {
  'image/jpeg': (image) => image.jpeg({ quality: 82, mozjpeg: true }),
  'image/png': (image) => image.png({ compressionLevel: 9 }),
  'image/webp': (image) => image.webp({ quality: 82 }),
};

async function encode(input, mime) {
  try {
    const image = sharp(input, { limitInputPixels: LANDING_IMAGE_LIMITS.inputPixels })
      .autoOrient()
      .resize({ width: LANDING_IMAGE_LIMITS.longSide, height: LANDING_IMAGE_LIMITS.longSide, fit: 'inside', withoutEnlargement: true });
    const { data, info } = await ENCODERS[mime](image).toBuffer({ resolveWithObject: true });
    return { mime, width: info.width, height: info.height, bytes: data };
  } catch (err) {
    if (/pixel limit/i.test(err?.message)) throw httpError(413, `That image has too many pixels (at most ${LANDING_IMAGE_LIMITS.inputPixels / 1_000_000} megapixels)`);
    const bad = httpError(400, 'That file could not be read as an image');
    bad.cause = err;
    throw bad;
  }
}

function megabytes(bytes) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
