import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getSetting, setSetting } from '../db.js';
import { store } from '../store.js';
import { sendError } from './sendError.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { verifyPassword } from '../passwords.js';
import { applyAiSettingsUpdate, normalizeAiSettings, publicAiSettings } from '../ai/aiSettings.js';
import { AiError } from '../ai/providers.js';
import { MAX_INSTRUCTION_LENGTH, rewriteBlock } from '../ai/rewrite.js';
import { hasRewritableShape } from '../ai/rewritableFields.js';
import { normalizeBrief, outlineScope, resumeOutline } from '../ai/brief.js';
import { hasLetterShape, rewriteLetter } from '../ai/letterWriting.js';
import { landingProfile, rewriteLanding } from '../ai/landingRewrite.js';
import { normalizePlanRequest, suggestTailoring } from '../ai/tailorPlan.js';

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
// a stuck client can't run up an unbounded bill. A rewrite with a brief
// (tailoring, brief.js) is one of a run of one request per block, so it
// counts against its own, larger cap instead: 30 would run out after a
// couple of runs. Each request counts against exactly one of the two.
const hasBrief = (req) => req.body?.brief != null;
const rewriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: hasBrief,
  message: { error: 'Too many AI rewrites in a short time. Wait a few minutes and try again.' },
});
const tailorLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => !hasBrief(req),
  message: { error: 'Too much AI tailoring in a short time. Wait a few minutes and try again.' },
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
// proposal through PUT /api/blocks/:id like any other edit. `target`
// (optional, see rewritableFields.js) narrows the rewrite to an experience
// block's description, one of its bullets, or one custom item; rewriteBlock
// rejects one that doesn't fit the block with a 400.
//
// `storeFor(req)` picks the resume the block is looked up in, as in
// routes/blocks.js: the default one at POST /api/ai/rewrite, the :resumeId
// one at POST /api/resumes/:resumeId/ai/rewrite (routes/resumes.js). Both
// share the same rate limiters, so the credit cap is per install.
//
// `brief` (optional, brief.js) tailors the rewrite to an audience and job
// posting. With one, the instruction may be empty (TAILOR_INSTRUCTION
// stands in), and a summary also sees an outline of the rest of its
// resume. An executive summary always sees one (brief.js's outlineScope).
export function rewriteHandlers(storeFor) {
  return [rewriteLimiter, tailorLimiter, (req, res) => rewrite(req, res, storeFor)];
}

async function rewrite(req, res, storeFor) {
  const { blockId, data, tense, target } = req.body || {};
  const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
  if (typeof blockId !== 'string') return res.status(400).json({ error: 'blockId is required' });
  let brief = null;
  try {
    if (hasBrief(req)) brief = normalizeBrief(req.body.brief);
  } catch (err) {
    return sendError(res, err);
  }
  if (!instruction && !brief) return res.status(400).json({ error: 'Tell the AI what to change.' });
  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    return res.status(400).json({ error: `Instructions are limited to ${MAX_INSTRUCTION_LENGTH} characters.` });
  }
  // Through the store so the lookup is scoped to a resume like every other
  // blocks query (a raw SELECT here would find another resume's block).
  let block;
  let outline = null;
  try {
    const resumeStore = storeFor(req);
    block = resumeStore.getBlock(blockId);
    const scope = outlineScope(block.type, Boolean(brief));
    if (scope) outline = resumeOutline(resumeStore.listBlocks(), block, scope);
  } catch (err) {
    return sendError(res, err);
  }

  const settings = normalizeAiSettings(getSetting('ai'));
  if (!publicAiSettings(settings).available) {
    return res.status(409).json({ error: 'AI rewriting is not set up. Add an API key in Account Settings.' });
  }

  // The editor autosaves on a debounce, so the client's copy can be a few
  // hundred ms ahead of the DB. Rewrite what the user is actually looking
  // at; the type always comes from the DB, and a malformed client copy
  // falls back to the saved one. A bullet or item target is an index into
  // the copy the client sent, so it can't be moved onto the saved copy: a
  // malformed copy with one is refused instead.
  const clientCopyUsable = hasRewritableShape(block.type, data);
  const positional = target?.kind === 'bullet' || target?.kind === 'item';
  if (!clientCopyUsable && data !== undefined && positional) {
    return res.status(400).json({ error: 'The block data sent with this rewrite is malformed. Reload and try again.' });
  }
  const baseData = clientCopyUsable ? data : block.data;
  try {
    // `tense` is the editor's per-rewrite pick for a custom block;
    // rewriteBlock turns a bad one (or a bad `target`) into a 400 AiError.
    // Being the one check, it comes after the 404 and 409 above, so a request
    // with a bad tense for a missing block, or with AI not set up, gets those
    // instead. The editor takes its options from the settings, so only
    // another client sends one.
    const proposal = await rewriteBlock({ type: block.type, data: baseData, instruction, settings, tense, target, brief, outline });
    res.json({ proposal: { blockId, baseData, ...proposal } });
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
    console.error('AI rewrite failed:', err);
    res.status(500).json({ error: 'AI rewrite failed unexpectedly.' });
  }
}

// A cover letter's AI writing (issue #71, letterWriting.js), at POST
// /api/resumes/:resumeId/cover-letters/:letterId/rewrite: drafting the whole
// letter (`target` omitted or { kind: 'letter' }) or rewriting one paragraph
// ({ kind: 'paragraph', index }). Like a block rewrite it returns a
// proposal and writes nothing, and `brief` is optional; it reads the
// resume's draft blocks and header as context. Same two rate limiters, so
// a draft with a brief counts as tailoring.
export function letterRewriteHandlers(storeFor) {
  return [rewriteLimiter, tailorLimiter, (req, res) => rewriteLetterRoute(req, res, storeFor)];
}

async function rewriteLetterRoute(req, res, storeFor) {
  const { data, target } = req.body || {};
  const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
  let brief = null;
  let letter;
  let blocks;
  let header;
  try {
    if (hasBrief(req)) brief = normalizeBrief(req.body.brief);
    const resumeStore = storeFor(req);
    letter = resumeStore.getCoverLetter(req.params.letterId);
    blocks = resumeStore.listBlocks();
    header = resumeStore.getHeader();
  } catch (err) {
    return sendError(res, err);
  }

  const settings = normalizeAiSettings(getSetting('ai'));
  if (!publicAiSettings(settings).available) {
    return res.status(409).json({ error: 'AI writing is not set up. Add an API key in Account Settings.' });
  }

  // As for a block: write from what the editor shows (its save may still
  // be on its debounce), falling back to the stored letter when the copy
  // sent is malformed, except under a paragraph target, which is an index
  // into the copy sent.
  const clientCopyUsable = hasLetterShape(data);
  if (!clientCopyUsable && data !== undefined && target?.kind === 'paragraph') {
    return res.status(400).json({ error: 'The letter sent with this rewrite is malformed. Reload and try again.' });
  }
  const baseData = clientCopyUsable ? data : letter.data;
  try {
    const proposal = await rewriteLetter({ data: baseData, header, blocks, instruction, settings, target, brief });
    res.json({ proposal: { letterId: letter.id, baseData, ...proposal } });
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
    console.error('AI cover letter writing failed:', err);
    res.status(500).json({ error: 'AI writing failed unexpectedly.' });
  }
}

// A tailoring plan (issue #84, ai/tailorPlan.js): what to hide for a brief
// and what to put first, read from the resume's stored draft. Like a
// rewrite it returns a proposal ({ plan }) and writes nothing; the editor
// saves accepted parts through the block and reorder routes. The brief is
// required, so it always counts against tailorLimiter: one request per run.
// Mounted like rewriteHandlers, the resume picked by the URL prefix.
export function tailorPlanHandlers(storeFor) {
  return [tailorLimiter, (req, res) => tailorPlan(req, res, storeFor)];
}

async function tailorPlan(req, res, storeFor) {
  let request;
  let blocks;
  try {
    request = normalizePlanRequest(req.body);
    blocks = storeFor(req).listBlocks();
  } catch (err) {
    return sendError(res, err);
  }

  const settings = normalizeAiSettings(getSetting('ai'));
  if (!publicAiSettings(settings).available) {
    return res.status(409).json({ error: 'AI rewriting is not set up. Add an API key in Account Settings.' });
  }
  try {
    res.json({ plan: await suggestTailoring({ blocks, request, settings }) });
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
    console.error('AI tailoring plan failed:', err);
    res.status(500).json({ error: 'AI tailoring failed unexpectedly.' });
  }
}

router.post('/rewrite', ...rewriteHandlers(() => store));
router.post('/tailor-plan', ...tailorPlanHandlers(() => store));

// The landing page's rewrite (issue #73, ai/landingRewrite.js), mounted by
// routes/landing.js at POST /api/landing/rewrite behind its requireAuth. It
// counts against the same rewriteLimiter as a block's. Returns
// { target, proposals: [{ target, before, after }], explanation } and saves
// nothing: the editor saves an accepted proposal through PUT /api/landing.
//
// `landing` is the editor's copy of the draft (ahead of the stored one by a
// debounce, like a block's `data`), checked as a save would check it; the
// editor leaves its photo out. Without one, the stored draft is used.
//
// There's no tailoring here, so a `brief` is refused before the limiter,
// which skips any request with one (it's tailorLimiter's to count).
export function landingRewriteHandlers() {
  return [refuseBrief, rewriteLimiter, landingRewrite];
}

function refuseBrief(req, res, next) {
  if (hasBrief(req)) return res.status(400).json({ error: 'A landing page rewrite takes no brief.' });
  next();
}

async function landingRewrite(req, res) {
  const { landing: copy, target } = req.body || {};
  const instruction = typeof req.body?.instruction === 'string' ? req.body.instruction.trim() : '';
  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    return res.status(400).json({ error: `Instructions are limited to ${MAX_INSTRUCTION_LENGTH} characters.` });
  }
  let landing;
  let profile;
  try {
    landing = copy === undefined ? store.getLanding() : store.checkLandingDraft(copy);
    // A blurb is about its card's resume; everything else about the person,
    // whose resume is the default. Either only while it's public and
    // published (visibleResumeSnapshot), never from a draft.
    const aboutId = target?.kind === 'card' && typeof target.resumeId === 'string' ? target.resumeId : undefined;
    profile = landingProfile(store.visibleResumeSnapshot(aboutId));
  } catch (err) {
    return sendError(res, err);
  }

  const settings = normalizeAiSettings(getSetting('ai'));
  if (!publicAiSettings(settings).available) {
    return res.status(409).json({ error: 'AI rewriting is not set up. Add an API key in Account Settings.' });
  }
  try {
    res.json(await rewriteLanding({ landing, target, instruction, settings, profile }));
  } catch (err) {
    if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
    console.error('AI landing rewrite failed:', err);
    res.status(500).json({ error: 'AI rewrite failed unexpectedly.' });
  }
}

export default router;
