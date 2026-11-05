import { Router } from 'express';
import { store } from '../store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { handle } from './sendError.js';

// Thin HTTP wrappers over the shared resume store (resumeStore.js), which
// holds all the actual logic — nesting rules, positions, touchDraft() — so
// the MCP tools (mcp/createMcpServer.js) behave identically. Store errors
// carry a `.status`; anything else is a genuine 500 (see sendError.js).
// `storeFor(req)` picks the resume: the default one for the unprefixed
// /api mount, the :resumeId one under /api/resumes (routes/resumes.js).
export function createBlockRoutes(storeFor) {
  const router = Router({ mergeParams: true });

  // All routes below require an authenticated editor session.
  router.use(requireAuth);

  router.get('/header', handle((req, res) => {
    res.json({ header: storeFor(req).getHeader() });
  }));

  router.put('/header', handle((req, res) => {
    res.json({ header: storeFor(req).setHeader(req.body) });
  }));

  router.get('/site', handle((req, res) => {
    res.json({ site: storeFor(req).getSite() });
  }));

  router.put('/site', handle((req, res) => {
    res.json({ site: storeFor(req).setSite(req.body) });
  }));

  router.get('/blocks', handle((req, res) => {
    res.json({ blocks: storeFor(req).listBlocks() });
  }));

  router.post('/blocks', handle((req, res) => {
    res.status(201).json({ block: storeFor(req).createBlock(req.body || {}) });
  }));

  router.put('/blocks/:id', handle((req, res) => {
    res.json({ block: storeFor(req).updateBlock(req.params.id, req.body || {}) });
  }));

  router.delete('/blocks/:id', handle((req, res) => {
    res.json(storeFor(req).deleteBlock(req.params.id));
  }));

  router.post('/blocks/reorder', handle((req, res) => {
    res.json({ blocks: storeFor(req).reorderBlocks((req.body || {}).items) });
  }));

  return router;
}

export default createBlockRoutes(() => store);
