import express from 'express';
import { EDITOR_FILE, NOINDEX, REVALIDATE } from '../cacheHeaders.js';
import { httpError } from '../httpError.js';
import { LANDING_FILE_LIMITS, contentDisposition } from '../landingFileFields.js';
import { handle, sendError } from './sendError.js';

// The landing page's documents (issue #128) over any store, so a test can
// drive them over :memory:; routes/landing.js mounts the editor's two
// (behind its login check) and routes/public.js the visitor's.
export function landingFileHandlers(store) {
  // POST /api/landing/files?name=<the picked file's name>: the PDF itself
  // as the body, parsed only here. Its type is told from its bytes, so any
  // Content-Type will do except application/json, which the app-wide
  // express.json() parses (and rejects) before this route sees it. Stripped
  // of its metadata and stored; responds with { id, size, name, src } for
  // the draft to reference ({ fileId: id, name }).
  const parseFile = express.raw({ type: () => true, limit: LANDING_FILE_LIMITS.uploadBytes });
  function fileBody(req, res, next) {
    parseFile(req, res, (err) => {
      if (!err) return next();
      const mb = LANDING_FILE_LIMITS.uploadBytes / (1024 * 1024);
      sendError(res, err.type === 'entity.too.large' ? httpError(413, `That file is too large (at most ${mb} MB)`) : httpError(400, 'Could not read the upload'));
    });
  }
  const upload = [
    fileBody,
    handle(async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw httpError(400, 'Send the PDF file itself as the request body');
      const name = typeof req.query.name === 'string' ? req.query.name : '';
      res.status(201).json(await store.uploadLandingFile(req.body, { name }));
    }),
  ];

  // GET /api/landing/files/:id[/:name]: any stored file, for the editor's
  // preview (the public route serves only what the published page shows).
  const editorFile = handle((req, res) => {
    const bytes = store.landingFile(req.params.id);
    if (!bytes) throw httpError(404, 'Not found');
    res.set('Cache-Control', EDITOR_FILE);
    sendPdf(res, req.params.id, req.params.name, bytes);
  });

  // GET /api/public/landing/files/:id/:name: a document the landing page
  // shows, by its id (the hash of its bytes) and the name it's shown
  // under, only while the page is shown and its published snapshot shows
  // it so (the store's publicLandingFile), so a draft-only upload isn't
  // public and a removed one is gone at once. Hence revalidated, not
  // immutable; the strong ETag makes that a 304.
  const publicFile = handle((req, res) => {
    res.set('Cache-Control', REVALIDATE);
    const file = store.publicLandingFile(req.params.id, req.params.name);
    if (!file) throw httpError(404, 'Not found');
    if (file.noindex) res.set('X-Robots-Tag', NOINDEX);
    sendPdf(res, req.params.id, req.params.name, file.bytes);
  });

  return { upload, editorFile, publicFile };
}

// Opened in the browser's own viewer, under its name. The sandbox CSP
// keeps it from running script or reaching the site's cookies should a
// browser ever render it as something else, and nosniff from being read
// as anything but a PDF.
function sendPdf(res, id, name, bytes) {
  res.set('ETag', `"${id}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Security-Policy', 'sandbox');
  res.set('Content-Disposition', contentDisposition(name));
  res.type('application/pdf').send(bytes);
}
