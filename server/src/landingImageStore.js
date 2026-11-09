import { httpError } from './httpError.js';
import { reencodeImage } from './imageUpload.js';
import { EDITOR_IMAGE_PATH, IMAGE_GRACE_MS, LANDING_IMAGE_LIMITS, isImageId } from './landingImageFields.js';

// The landing page's image store (issue #92): the `landing_images` table,
// composed into the landing store by createLandingStore(), which decides
// what the public may see (publicLandingImage()). `referencedIds()` lists
// every image the stored draft or the published snapshot names; those are
// never deleted. `now` is for tests.
export function createLandingImageStore({ db, referencedIds, now = () => Date.now() }) {
  function stats() {
    return db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(bytes)), 0) AS total FROM landing_images').get();
  }

  // Deletes every image nothing references that was stored more than
  // IMAGE_GRACE_MS ago. Returns how many went.
  function pruneImages() {
    const keep = referencedIds();
    const cutoff = new Date(now() - IMAGE_GRACE_MS).toISOString();
    const stale = db
      .prepare('SELECT id FROM landing_images WHERE created_at < ?')
      .all(cutoff)
      .filter((row) => !keep.has(row.id));
    const remove = db.prepare('DELETE FROM landing_images WHERE id = ?');
    db.transaction(() => stale.forEach((row) => remove.run(row.id)))();
    return stale.length;
  }

  // Re-encodes `input` (imageUpload.js) and stores it, within the caps.
  // The same image uploaded again is the same row, its clock restarted so
  // the grace period counts from now.
  async function uploadImage(input, options) {
    const image = await reencodeImage(input, options);
    // Synchronous from here on, so two uploads can't both squeeze under a cap.
    const stamp = new Date(now()).toISOString();
    if (db.prepare('SELECT 1 FROM landing_images WHERE id = ?').get(image.id)) {
      db.prepare('UPDATE landing_images SET created_at = ? WHERE id = ?').run(stamp, image.id);
    } else {
      if (!fits(image.bytes.length)) pruneImages();
      if (!fits(image.bytes.length)) {
        throw httpError(
          409,
          `The image store is full (at most ${LANDING_IMAGE_LIMITS.count} images, ${LANDING_IMAGE_LIMITS.totalBytes / (1024 * 1024)} MB). ` +
            'An image no longer used on the page is removed a week after it was uploaded.'
        );
      }
      db.prepare('INSERT INTO landing_images (id, mime, width, height, bytes, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        image.id,
        image.mime,
        image.width,
        image.height,
        image.bytes,
        stamp
      );
    }
    return { id: image.id, mime: image.mime, width: image.width, height: image.height, src: EDITOR_IMAGE_PATH + image.id };
  }

  function fits(size) {
    const { count, total } = stats();
    return count < LANDING_IMAGE_LIMITS.count && total + size <= LANDING_IMAGE_LIMITS.totalBytes;
  }

  // { mime, bytes } of a stored image, or null.
  function imageFile(id) {
    if (!isImageId(id)) return null;
    return db.prepare('SELECT mime, bytes FROM landing_images WHERE id = ?').get(id) ?? null;
  }

  // Every stored image's size, by id (no bytes).
  function imageSizes() {
    return new Map(db.prepare('SELECT id, width, height FROM landing_images').all().map((row) => [row.id, { width: row.width, height: row.height }]));
  }

  return { uploadImage, imageFile, imageSizes, pruneImages };
}
