// The resume store bound to the real database and PDF renderer. Routes and
// the MCP endpoint import this; tests build their own via createResumeStore.
import { db } from './db.js';
import { renderResumePdf } from './pdfRenderer.js';
import { PDF_DIR } from './pdfPaths.js';
import { createResumeStore } from './resumeStore.js';

// The renderer loads /print?resume=<id>, but the client and
// /api/public/resume don't read that parameter yet, so a render for any
// other resume would quietly capture the default one and be filed as that
// resume's current PDF. Refuse instead until /print honours it.
function renderPdf({ signal, resumeId }) {
  if (resumeId !== store.defaultResumeId()) {
    throw new Error('PDF rendering is only supported for the default resume so far');
  }
  return renderResumePdf({ signal, resumeId });
}

export const store = createResumeStore({ db, renderPdf, pdfDir: PDF_DIR });
