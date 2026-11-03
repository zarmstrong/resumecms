import { Router } from 'express';
import { store } from '../store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { handle } from './sendError.js';

// Thin wrappers over the shared resume store (see routes/blocks.js).
const router = Router();

// All routes below require an authenticated editor session.
router.use(requireAuth);

router.get('/publish/status', handle((req, res) => {
  res.json(store.getPublishStatus());
}));

// A failed PDF render still answers with the store's own message ("the
// site is updated, the PDF is not") so the editor can say what actually
// happened; the Chromium error itself only goes to the log (see handle).
router.post('/publish', handle(async (req, res) => {
  res.json(await store.publish());
}));

router.post('/discard-draft', handle((req, res) => {
  res.json(store.discardDraft());
}));

export default router;
