import { Router } from 'express';
import { store } from '../store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { handle } from './sendError.js';
import { LANDING_LIMITS } from '../landingFields.js';

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

// Replaces the draft; see landingFields.js for the shape.
router.put('/', handle((req, res) => {
  const landing = store.setLanding(req.body);
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

// { enabled } — takes effect at once; see the store's setLandingEnabled.
router.put('/enabled', handle((req, res) => {
  res.json(store.setLandingEnabled((req.body || {}).enabled));
}));

export default router;
