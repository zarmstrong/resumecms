// The resume store bound to the real database and PDF renderer. Routes and
// the MCP endpoint import this; tests build their own via createResumeStore.
import { db } from './db.js';
import { renderResumePdf } from './pdfRenderer.js';
import { PDF_DIR } from './pdfPaths.js';
import { createResumeStore } from './resumeStore.js';

export const store = createResumeStore({ db, renderPdf: renderResumePdf, pdfDir: PDF_DIR });
