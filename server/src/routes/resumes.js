import { Router } from 'express';
import { store } from '../store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { handle } from './sendError.js';
import { createBlockRoutes } from './blocks.js';
import { createPublishRoutes } from './publish.js';
import { rewriteHandlers } from './ai.js';

// Managing the install's resumes (issue #53), plus every editor route for
// one resume under /api/resumes/:resumeId (AI rewrite included) — the same
// handlers the unprefixed /api routes run for the default resume. Thin
// wrappers over the store like the rest (see routes/blocks.js); an unknown
// :resumeId is a 404 from store.forResume(). Mounted before the catch-all
// /api routers (see index.js).
const router = Router();

// All routes below require an authenticated editor session.
router.use(requireAuth);

router.get('/', handle((req, res) => {
  res.json({ resumes: store.listResumes() });
}));

// { name, slug?, copyFrom? } — see the store's createResume.
router.post('/', handle((req, res) => {
  res.status(201).json({ resume: store.createResume(req.body || {}) });
}));

router.get('/:resumeId', handle((req, res) => {
  res.json({ resume: store.getResume(req.params.resumeId) });
}));

// Any of { name, slug, isPublic, isDefault: true } — see updateResume.
router.patch('/:resumeId', handle((req, res) => {
  res.json({ resume: store.updateResume(req.params.resumeId, req.body || {}) });
}));

router.delete('/:resumeId', handle((req, res) => {
  res.json(store.deleteResume(req.params.resumeId));
}));

const forResume = (req) => store.forResume(req.params.resumeId);
router.post('/:resumeId/ai/rewrite', ...rewriteHandlers(forResume));
router.use('/:resumeId', createBlockRoutes(forResume));
router.use('/:resumeId', createPublishRoutes(forResume));

export default router;
