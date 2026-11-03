import { Router } from 'express';
import fs from 'node:fs';
import { getSetting } from '../db.js';
import { PDF_PATH } from '../pdfRenderer.js';
import { PDF as PDF_CACHE_CONTROL } from '../cacheHeaders.js';

const router = Router();

router.get('/resume.pdf', (req, res) => {
  // Keep shared caches out and make browsers revalidate (see
  // cacheHeaders.js) — a CDN that caches by file extension would otherwise
  // keep handing out the previous render for hours after a publish. Set
  // before anything else so the "no PDF yet" 404 isn't cacheable either.
  // The `?v=` the client appends (the store's pdfVersion) is ignored here;
  // it only exists to give each render a fresh URL.
  res.set('Cache-Control', PDF_CACHE_CONTROL);
  if (!fs.existsSync(PDF_PATH)) {
    return res.status(404).json({ error: 'No PDF has been published yet' });
  }

  const published = getSetting('published_resume') || {};
  const header = published.header || {};
  const name = (header.name || 'Resume').trim().replace(/[^a-z0-9]+/gi, ' ').trim().replace(/\s+/g, '-');
  const fileName = `Resume-of-${name}.pdf`;

  // The PDF headers go through sendFile's `headers` option so they're only
  // applied once the file is actually being sent — an error response below
  // must not go out labelled as a PDF attachment. sendFile still adds
  // Last-Modified/ETag, so an unchanged file is a 304; cacheControl: false
  // keeps it from replacing the header set above.
  const options = {
    cacheControl: false,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  };
  res.sendFile(PDF_PATH, options, (err) => {
    // The client going away mid-download isn't an error of ours, and once
    // headers are out there's nothing left to say.
    if (!err || err.code === 'ECONNABORTED' || res.headersSent) return;
    // The file vanished between the check above and the send (a render is
    // replacing it): answer like the check would have, instead of leaving
    // it to Express's HTML error page.
    const status = err.status ?? err.statusCode ?? 500;
    res.status(status).json({ error: status === 404 ? 'No PDF has been published yet' : 'Could not read the PDF' });
  });
});

export default router;
