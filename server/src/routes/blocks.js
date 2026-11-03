import { Router } from 'express';
import { store } from '../store.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { sendError } from './sendError.js';

// Thin HTTP wrappers over the shared resume store (resumeStore.js), which
// holds all the actual logic — nesting rules, positions, touchDraft() — so
// the MCP tools (mcp/createMcpServer.js) behave identically. Store errors
// carry a `.status`; anything else is a genuine 500 (see sendError.js).
const router = Router();

// All routes below require an authenticated editor session.
router.use(requireAuth);

const handle = (fn) => (req, res) => {
  try {
    fn(req, res);
  } catch (err) {
    sendError(res, err);
  }
};

router.get('/header', handle((req, res) => {
  res.json({ header: store.getHeader() });
}));

router.put('/header', handle((req, res) => {
  res.json({ header: store.setHeader(req.body) });
}));

router.get('/site', handle((req, res) => {
  res.json({ site: store.getSite() });
}));

router.put('/site', handle((req, res) => {
  res.json({ site: store.setSite(req.body) });
}));

router.get('/blocks', handle((req, res) => {
  res.json({ blocks: store.listBlocks() });
}));

router.post('/blocks', handle((req, res) => {
  res.status(201).json({ block: store.createBlock(req.body || {}) });
}));

router.put('/blocks/:id', handle((req, res) => {
  res.json({ block: store.updateBlock(req.params.id, req.body || {}) });
}));

router.delete('/blocks/:id', handle((req, res) => {
  res.json(store.deleteBlock(req.params.id));
}));

router.post('/blocks/reorder', handle((req, res) => {
  res.json({ blocks: store.reorderBlocks((req.body || {}).items) });
}));

export default router;
