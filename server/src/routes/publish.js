import { Router } from 'express';
import { store } from '../store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { handle } from './sendError.js';

// Thin wrappers over the shared resume store (see routes/blocks.js).
// `storeFor(req)` picks the resume: the default one for the unprefixed
// /api mount, the :resumeId one under /api/resumes (routes/resumes.js).
export function createPublishRoutes(storeFor) {
  const router = Router({ mergeParams: true });

  // All routes below require an authenticated editor session.
  router.use(requireAuth);

  router.get('/publish/status', handle((req, res) => {
    res.json(storeFor(req).getPublishStatus());
  }));

  // A failed PDF render still answers with the store's own message ("the
  // site is updated, the PDF is not") so the editor can say what actually
  // happened; the Chromium error itself only goes to the log (see handle).
  router.post('/publish', handle(async (req, res) => {
    res.json(await storeFor(req).publish());
  }));

  router.post('/discard-draft', handle((req, res) => {
    res.json(storeFor(req).discardDraft());
  }));

  return router;
}

export default createPublishRoutes(() => store);
