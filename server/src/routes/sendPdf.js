import { PDF as PDF_CACHE_CONTROL } from '../cacheHeaders.js';
import { sendError } from './sendError.js';
import { pdfFileName } from '../pdfFileName.js';

// Sends the rendered PDF of the resume `resolve()` returns (a scoped store;
// resolving may throw a 404), as a download: the public PDF routes in
// routes/pdf.js and the editor's per-resume download in routes/resumes.js.
export function sendResumePdf(res, resolve) {
  // Keep shared caches out and make browsers revalidate (see
  // cacheHeaders.js) — a CDN that caches by file extension would otherwise
  // keep handing out the previous render for hours after a publish. Set
  // before anything else so the "no PDF yet" 404 isn't cacheable either.
  // The `?v=` the client appends (the store's pdfVersion) is ignored here;
  // it only exists to give each render a fresh URL.
  res.set('Cache-Control', PDF_CACHE_CONTROL);
  let pdf;
  try {
    pdf = resolve().getPdfFile();
  } catch (err) {
    return sendError(res, err);
  }
  if (!pdf) {
    return res.status(404).json({ error: 'No PDF has been published yet' });
  }

  const fileName = pdfFileName(pdf.name);

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
  res.sendFile(pdf.path, options, (err) => {
    // The client going away mid-download isn't an error of ours, and once
    // headers are out there's nothing left to say.
    if (!err || err.code === 'ECONNABORTED' || res.headersSent) return;
    // The file vanished between the check above and the send (a render is
    // replacing it): answer like the check would have, instead of leaving
    // it to Express's HTML error page.
    const status = err.status ?? err.statusCode ?? 500;
    res.status(status).json({ error: status === 404 ? 'No PDF has been published yet' : 'Could not read the PDF' });
  });
}
