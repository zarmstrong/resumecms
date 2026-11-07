import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { PDF as PDF_CACHE_CONTROL } from '../cacheHeaders.js';
import { letterPdfFileName } from '../pdfFileName.js';
import { httpError } from '../httpError.js';
import { handle } from './sendError.js';

// A resume's cover letters (issue #71), under
// /api/resumes/:resumeId/cover-letters only: like every per-resume route,
// the resume is the URL prefix, never a body field. Thin wrappers over the
// store (see routes/blocks.js and coverLetterStore.js).
export function createCoverLetterRoutes(storeFor) {
  const router = Router({ mergeParams: true });

  router.use(requireAuth);

  router.get('/cover-letters', handle((req, res) => {
    res.json({ coverLetters: storeFor(req).listCoverLetters() });
  }));

  // { title?, data? } or { title?, copyFrom: <letter id> }.
  router.post('/cover-letters', handle((req, res) => {
    res.status(201).json({ coverLetter: storeFor(req).createCoverLetter(req.body || {}) });
  }));

  router.get('/cover-letters/:letterId', handle((req, res) => {
    res.json({ coverLetter: storeFor(req).getCoverLetter(req.params.letterId) });
  }));

  // { title?, data? }: `data` replaces the letter's data whole.
  router.put('/cover-letters/:letterId', handle((req, res) => {
    res.json({ coverLetter: storeFor(req).updateCoverLetter(req.params.letterId, req.body || {}) });
  }));

  router.delete('/cover-letters/:letterId', handle((req, res) => {
    res.json(storeFor(req).deleteCoverLetter(req.params.letterId));
  }));

  // Rendered on demand (or the cached render, when nothing it shows has
  // changed), as a download. Private like every PDF route; the header is
  // set first so an error response carries it too.
  router.get('/cover-letters/:letterId/letter.pdf', handle(async (req, res) => {
    res.set('Cache-Control', PDF_CACHE_CONTROL);
    const pdf = await storeFor(req).coverLetterPdf(req.params.letterId);
    await new Promise((resolve, reject) => {
      res.sendFile(
        pdf.path,
        {
          cacheControl: false,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${letterPdfFileName(pdf.name, pdf.company)}"`,
          },
        },
        (err) => {
          // A client gone mid-download, or a failure once headers are out:
          // nothing left to answer.
          // Otherwise the file vanished before it was read (the letter was
          // deleted meanwhile).
          if (!err || err.code === 'ECONNABORTED' || res.headersSent) resolve();
          else reject(httpError((err.status ?? err.statusCode) === 404 ? 404 : 500, 'Could not read the PDF'));
        }
      );
    });
  }));

  return router;
}
