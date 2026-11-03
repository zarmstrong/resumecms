import { Router } from 'express';
import { store } from '../store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendError } from './sendError.js';

// Thin wrappers over the shared resume store (see routes/blocks.js).
const router = Router();

// All routes below require an authenticated editor session.
router.use(requireAuth);

router.get('/publish/status', (req, res) => {
  try {
    res.json(store.getPublishStatus());
  } catch (err) {
    sendError(res, err);
  }
});

// A failed PDF render still answers with the store's own message ("the
// site is updated, the PDF is not") so the editor can say what actually
// happened; the Chromium error itself only goes to the log (sendError).
router.post('/publish', async (req, res) => {
  try {
    res.json(await store.publish());
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/discard-draft', (req, res) => {
  try {
    res.json(store.discardDraft());
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
