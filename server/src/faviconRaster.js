import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { etagOf } from './favicon.js';

// /apple-touch-icon.png (issue #104): favicon.js's SVG drawn as a square
// PNG by sharp (librsvg underneath). Besides imageUpload.js, the only
// module that loads sharp, and only routes/favicon.js imports it, so
// nothing the client's tests import pulls in the native binary.
//
// A render takes a few milliseconds of sharp's own thread pool, never the
// PDF queue, and every visitor's browser asks for the icon, so renders are
// kept in memory by the hash of the SVG they're drawn from: the same name
// and colors are drawn once. At most `maxEntries` are kept (a few KB each),
// the least recently used dropped first, so hosts and edits can't grow it
// without limit. A render in flight is shared by everyone asking for it,
// and forgotten if it fails.

export const RASTER_CACHE_ENTRIES = 32;

export function createFaviconRaster({ size, maxEntries = RASTER_CACHE_ENTRIES, render = renderPng } = {}) {
  const cache = new Map();

  // Resolves with { bytes, etag } for `svg`.
  function pngFor(svg) {
    const key = createHash('sha256').update(svg).digest('hex');
    let entry = cache.get(key);
    if (entry) {
      // Map keeps insertion order: re-inserting marks it most recent.
      cache.delete(key);
    } else {
      entry = render(svg, size).then((bytes) => ({ bytes, etag: etagOf(bytes) }));
      entry.catch(() => {
        if (cache.get(key) === entry) cache.delete(key);
      });
    }
    cache.set(key, entry);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return entry;
  }

  return { pngFor, size: () => cache.size };
}

// The SVG's own size is its viewBox's (64); a density in proportion draws
// it straight at `size` instead of scaling up a small bitmap. The square
// is opaque edge to edge, so the alpha channel goes.
async function renderPng(svg, size) {
  const input = Buffer.from(svg);
  const { width } = await sharp(input).metadata();
  return sharp(input, { density: (72 * size) / (width || size) })
    .resize(size, size)
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
}
