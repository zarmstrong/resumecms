import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './dataDir.js';

// Where rendered PDFs live: one per resume, at <PDF_DIR>/<resume id>.pdf
// (see pdfPathFor below). Keyed by the stable id, not the
// slug, so renaming a resume never orphans its file. Written only by the
// store's PDF queue, served as-is by routes/pdf.js.
export const PDF_DIR = path.join(DATA_DIR, 'pdf');

// The single PDF an install had before resume variants; the migration
// moves it to the default resume's path.
export const LEGACY_PDF_PATH = path.join(DATA_DIR, 'resume.pdf');

// The one place a resume's PDF location is derived, shared by the store,
// the migration and the tests.
export function pdfPathFor(pdfDir, resumeId) {
  return path.join(pdfDir, `${resumeId}.pdf`);
}

// Identifies the PDF at `filePath` (mtime plus size, so even a filesystem
// with coarse timestamps tells two renders apart), or null if there is
// none. The client appends it to the PDF URL as `?v=` so every render
// yields a URL no cache has seen before (see routes/pdf.js and
// client/src/resume/pdfUrl.js).
export function pdfVersionOf(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return `${Math.floor(stat.mtimeMs)}-${stat.size}`;
  } catch {
    return null;
  }
}

// A cover letter's PDF (issue #71), rendered on demand and kept until its
// content changes. A directory of its own, so a letter id can never be
// mistaken for a resume id's file.
export function letterPdfPathFor(pdfDir, letterId) {
  return path.join(pdfDir, 'letters', `${letterId}.pdf`);
}

// Writes a rendered PDF to a sibling temp file and renames it into place,
// so a download overlapping a render never reads a half-written PDF and a
// crash mid-write can't leave a truncated file that looks valid.
export function writePdfAtomically(filePath, buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, buffer);
    fs.renameSync(tmp, filePath);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}
