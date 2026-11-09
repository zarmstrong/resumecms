import express, { Router } from 'express';
import { store } from '../store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { handle, sendError } from './sendError.js';
import { LANDING_LIMITS } from '../landingFields.js';
import { LANDING_IMAGE_LIMITS } from '../landingImageFields.js';
import { EDITOR_IMAGE } from '../cacheHeaders.js';
import { httpError } from '../httpError.js';
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
    limits: { ...LANDING_LIMITS, images: LANDING_IMAGE_LIMITS },
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

// An image upload (issue #92): the file itself as the body, whatever its
// Content-Type says (the type is told from its bytes), parsed only here and
// only after the login check above. Re-encoded and stored; responds with
// { id, mime, width, height, src } for the draft to reference.
const parseImage = express.raw({ type: () => true, limit: LANDING_IMAGE_LIMITS.uploadBytes });
function imageBody(req, res, next) {
  parseImage(req, res, (err) => {
    if (!err) return next();
    const mb = LANDING_IMAGE_LIMITS.uploadBytes / (1024 * 1024);
    sendError(res, err.type === 'entity.too.large' ? httpError(413, `That image is too large (at most ${mb} MB)`) : httpError(400, 'Could not read the upload'));
  });
}

router.post('/images', imageBody, handle(async (req, res) => {
  if (!Buffer.isBuffer(req.body)) throw httpError(400, 'Send the image file itself as the request body');
  res.status(201).json(await store.uploadLandingImage(req.body));
}));

// Any stored image, for the editor's preview (the public route serves only
// what the published page shows).
router.get('/images/:id', handle((req, res) => {
  const image = store.landingImage(req.params.id);
  if (!image) throw httpError(404, 'Not found');
  res.set('Cache-Control', EDITOR_IMAGE);
  res.set('ETag', `"${req.params.id}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.type(image.mime).send(image.bytes);
}));

// { enabled } — takes effect at once; see the store's setLandingEnabled.
router.put('/enabled', handle((req, res) => {
  res.json(store.setLandingEnabled((req.body || {}).enabled));
}));

export default router;
