import { httpError } from './httpError.js';
import { stripPdf } from './pdfUpload.js';
import { IMAGE_GRACE_MS } from './landingImageFields.js';
import { EDITOR_FILE_PATH, LANDING_FILE_LIMITS, cleanFileName, isFileId } from './landingFileFields.js';

// The landing page's file store (issue #128): the `landing_files` table,
// next to the image store and composed into the landing store the same way
// by createLandingStore(), which decides what the public may see
// (publicLandingFile()). `referencedIds()` lists every file the stored
// draft or the published snapshot names; those are never deleted. `now` is
// for tests.
export function createLandingFileStore({ db, referencedIds, now = () => Date.now() }) {
  function stats() {
    return db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(bytes)), 0) AS total FROM landing_files').get();
  }

  // Deletes every file nothing references that was stored more than
  // IMAGE_GRACE_MS ago (the images' grace period). Returns how many went.
  function pruneFiles() {
    const keep = referencedIds();
    const cutoff = new Date(now() - IMAGE_GRACE_MS).toISOString();
    const stale = db
      .prepare('SELECT id FROM landing_files WHERE created_at < ?')
      .all(cutoff)
      .filter((row) => !keep.has(row.id));
    const remove = db.prepare('DELETE FROM landing_files WHERE id = ?');
    db.transaction(() => stale.forEach((row) => remove.run(row.id)))();
    return stale.length;
  }

  // Strips `input`'s metadata (pdfUpload.js) and stores it, within the
  // caps. The same file uploaded again is the same row, its clock restarted
  // so the grace period counts from now. `name` is the picked file's name,
  // cleaned (cleanFileName()) for the draft to reference it by.
  async function uploadFile(input, { name, ...options } = {}) {
    const file = await stripPdf(input, options);
    // Synchronous from here on, so two uploads can't both squeeze under a cap.
    const stamp = new Date(now()).toISOString();
    if (db.prepare('SELECT 1 FROM landing_files WHERE id = ?').get(file.id)) {
      db.prepare('UPDATE landing_files SET created_at = ? WHERE id = ?').run(stamp, file.id);
    } else {
      if (!fits(file.bytes.length)) pruneFiles();
      if (!fits(file.bytes.length)) {
        throw httpError(
          409,
          `The document store is full (at most ${LANDING_FILE_LIMITS.count} files, ${LANDING_FILE_LIMITS.totalBytes / (1024 * 1024)} MB). ` +
            'A file no longer used on the page is removed a week after it was uploaded.'
        );
      }
      db.prepare('INSERT INTO landing_files (id, bytes, created_at) VALUES (?, ?, ?)').run(file.id, file.bytes, stamp);
    }
    return { id: file.id, size: file.bytes.length, name: cleanFileName(name), src: EDITOR_FILE_PATH + file.id };
  }

  function fits(size) {
    const { count, total } = stats();
    return count < LANDING_FILE_LIMITS.count && total + size <= LANDING_FILE_LIMITS.totalBytes;
  }

  // The bytes of a stored file, or null.
  function storedFile(id) {
    if (!isFileId(id)) return null;
    return db.prepare('SELECT bytes FROM landing_files WHERE id = ?').get(id)?.bytes ?? null;
  }

  // Every stored file's size in bytes, by id (no bytes).
  function fileSizes() {
    return new Map(db.prepare('SELECT id, LENGTH(bytes) AS size FROM landing_files').all().map((row) => [row.id, row.size]));
  }

  return { uploadFile, storedFile, fileSizes, pruneFiles };
}
