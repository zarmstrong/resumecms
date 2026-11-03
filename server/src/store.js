// The resume store bound to the real database and PDF renderer. Routes and
// the MCP endpoint import this; tests build their own via createResumeStore.
import { db } from './db.js';
import { renderResumePdf, PDF_PATH } from './pdfRenderer.js';
import { createResumeStore } from './resumeStore.js';

export const store = createResumeStore({ db, renderPdf: renderResumePdf, pdfPath: PDF_PATH });
