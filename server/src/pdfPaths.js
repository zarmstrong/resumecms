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
