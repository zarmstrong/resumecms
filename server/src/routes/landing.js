import { Router } from 'express';
import { store } from '../store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { handle } from './sendError.js';
import { LANDING_LIMITS } from '../landingFields.js';
import { landingRewriteHandlers } from './ai.js';
import { splitTextFormat } from '../landingTextMigration.js';

// The editor's routes for the landing page (issue #70), thin wrappers over
// the store (landingStore.js) like the rest. Mounted at /api/landing before
// the catch-all /api routers (see index.js). The public side is
// /api/public/home (routes/public.js).
const router = Router();

// All routes below require an authenticated editor session.
router.use(requireAuth);

// The draft, its status, what the preview resolves it against (the
// default resume's published photo and look, and the resumes a card can
// link to), and the fields' caps for the form.
router.get('/', handle((req, res) => {
  res.json({
    landing: store.getLanding(),
    status: store.getLandingStatus(),
    context: store.getLandingContext(),
    limits: LANDING_LIMITS,
  });
}));

// Replaces the draft; see landingFields.js for the shape. The editor marks
// it `textFormat: 'inline'`; without that its text is plain and escaped
// (an editor loaded before issue #91, see landingTextMigration.js).
router.put('/', handle((req, res) => {
  const { landing: input, textFormat } = splitTextFormat(req.body);
  const landing = store.setLanding(input, { textFormat });
  res.json({ landing, status: store.getLandingStatus() });
}));

router.get('/status', handle((req, res) => {
  res.json(store.getLandingStatus());
}));

router.post('/publish', handle((req, res) => {
  res.json(store.publishLanding());
}));

router.post('/discard-draft', handle((req, res) => {
  const landing = store.discardLandingDraft();
  res.json({ landing, status: store.getLandingStatus() });
}));

// { landing?, target, instruction } → proposals for review; saves nothing.
// See landingRewriteHandlers in routes/ai.js.
router.post('/rewrite', ...landingRewriteHandlers());

// { enabled } — takes effect at once; see the store's setLandingEnabled.
router.put('/enabled', handle((req, res) => {
  res.json(store.setLandingEnabled((req.body || {}).enabled));
}));

export default router;
