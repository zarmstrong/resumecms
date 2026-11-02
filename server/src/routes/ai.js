import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db, getSetting, setSetting, rowToBlock } from '../db.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { verifyPassword } from '../passwords.js';
import { applyAiSettingsUpdate, normalizeAiSettings, publicAiSettings } from '../ai/aiSettings.js';
import { AiError } from '../ai/providers.js';
import { MAX_INSTRUCTION_LENGTH, rewriteBlock } from '../ai/rewrite.js';
import { hasRewritableShape } from '../ai/rewritableFields.js';

const router = Router();

// Same idea as auth.js's credentialsLimiter: adding or removing an API key
// needs the current password, so failed attempts are capped. Only a wrong
// password (401) counts — a mistyped timeout or model name shouldn't lock
// the owner out of settings.
const settingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode !== 401,
  message: { error: 'Too many attempts. Please try again later.' },
});

// Every rewrite spends the owner's provider credits, so a stolen session or
// a stuck client can't run up an unbounded bill.
const rewriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many AI rewrites in a short time. Wait a few minutes and try again.' },
});

// All routes below require an authenticated editor session.
router.use(requireAuth);

router.get('/settings', (req, res) => {
  res.json({ ai: publicAiSettings(getSetting('ai')) });
});

// Not a draft change — AI settings aren't resume content, so no touchDraft().
router.put('/settings', settingsLimiter, (req, res) => {
  let result;
  try {
    result = applyAiSettingsUpdate(getSetting('ai'), req.body);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  if (result.keysChanged) {
    const credentials = getSetting('credentials');
    if (!verifyPassword(req.body?.currentPassword, credentials?.passwordHash)) {
      return res.status(401).json({ error: 'Enter your current password to add or remove an API key.' });
    }
  }
  setSetting('ai', result.settings);
  res.json({ ai: publicAiSettings(result.settings) });
});

// Returns a proposal only; nothing is written. The editor saves an accepted
// proposal through PUT /api/blocks/:id like any other edit.
router.post('/rewrite', rewriteLimiter, async (req, res) => {
  const { blockId, data } = req.body || {};
  const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
  if (typeof blockId !== 'string') return res.status(400).json({ error: 'blockId is required' });
  if (!instruction) return res.status(400).json({ error: 'Tell the AI what to change.' });
  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    return res.status(400).json({ error: `Instructions are limited to ${MAX_INSTRUCTION_LENGTH} characters.` });
  }
  const row = db.prepare('SELECT * FROM blocks WHERE id = ?').get(blockId);
  if (!row) return res.status(404).json({ error: 'Block not found' });

  const settings = normalizeAiSettings(getSetting('ai'));
  if (!publicAiSettings(settings).available) {
    return res.status(409).json({ error: 'AI rewriting is not set up. Add an API key in Account Settings.' });
  }

  const block = rowToBlock(row);
  // The editor autosaves on a debounce, so the client's copy can be a few
  // hundred ms ahead of the DB. Rewrite what the user is actually looking
  // at; the type always comes from the DB, and a malformed client copy
  // falls back to the saved one.
  const baseData = hasRewritableShape(block.type, data) ? data : block.data;
  try {
    const proposal = await rewriteBlock({ type: block.type, data: baseData, instruction, settings });
    res.json({ proposal: { blockId, baseData, ...proposal } });
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
    console.error('AI rewrite failed:', err);
    res.status(500).json({ error: 'AI rewrite failed unexpectedly.' });
  }
});

export default router;
