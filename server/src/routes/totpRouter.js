import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { generateSecret, generateURI } from 'otplib';
import QRCode from 'qrcode';
import { isAuthenticated, reissueSession } from '../authSessions.js';
import { verifyPassword } from '../passwords.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { verifyCode } from '../totpCode.js';

// The 2FA routes over an injected `getSetting`/`setSetting` (the global
// settings table in totp.js), so totpRouter.test.js runs without db.js.
//
// The `totp` row is `{ enabled, secret, pendingSecret?, lastUsedStep? }`:
// `secret` is the active factor (what login checks, only while `enabled`)
// and `pendingSecret` a setup not yet confirmed (issue #173). A row stored
// before that, `{ secret, enabled: false }`, was a setup in progress, so
// it reads as a pending secret with no active one. `enabled` is read as
// login reads it (truthy), so the two never disagree about whether 2FA is
// on, and only the known fields are kept.
export function readTotp(row) {
  if (!row) return { enabled: false, secret: null, pendingSecret: null, lastUsedStep: null };
  const lastUsedStep = typeof row.lastUsedStep === 'number' ? row.lastUsedStep : null;
  if (row.enabled) {
    return { enabled: true, secret: row.secret ?? null, pendingSecret: row.pendingSecret ?? null, lastUsedStep };
  }
  return { enabled: false, secret: null, pendingSecret: row.pendingSecret ?? row.secret ?? null, lastUsedStep };
}

// The row to store for `totp`, optional fields only when set.
function totpRow({ enabled, secret, pendingSecret, lastUsedStep }) {
  return {
    enabled,
    ...(enabled ? { secret } : {}),
    ...(pendingSecret ? { pendingSecret } : {}),
    ...(typeof lastUsedStep === 'number' ? { lastUsedStep } : {}),
  };
}

const checkCode = verifyCode;

// One message for a wrong password, a wrong code and a code already used,
// so the reply never says which part was right (a "code already used"
// would confirm the password). It says why a right code can fail: right
// after a login the app still shows the code just used.
export const FACTOR_ERROR =
  'Incorrect password or code. Each code works only once: if you just used this one, wait for the next.';
export const PASSWORD_ERROR = 'Incorrect password';

// Any change to 2FA needs the current password, and while it's on a code
// from the active factor that hasn't been used, never just the session:
// a stolen session cookie can't remove 2FA, replace it, or turn it on with
// an app of its own and lock the owner out. Returns `{ step }` (the code's
// step while 2FA is on, else null) or `{ error }`.
async function checkFactor(totp, credentials, { currentPassword, totpToken } = {}) {
  const passwordOk =
    typeof currentPassword === 'string' && !!credentials && verifyPassword(currentPassword, credentials.passwordHash);
  if (!totp.enabled) return passwordOk ? { step: null } : { error: PASSWORD_ERROR };
  const step = await checkCode(totp.secret, totpToken);
  if (!passwordOk || step === null || isSpent(totp, step)) return { error: FACTOR_ERROR };
  return { step };
}

const isSpent = (totp, step) => totp.lastUsedStep !== null && step <= totp.lastUsedStep;

// Every check above awaits, so before writing, each route reads the row
// again and goes on only if the factor it checked is still the one stored
// (and, for a code, that it still isn't spent), then writes with nothing
// awaited in between. Two requests can then never both spend one code, and
// a slow one can't write back a row another has changed since.
const sameFactor = (a, b) => a.enabled === b.enabled && a.secret === b.secret;
const CHANGED_ERROR = 'Two-factor settings changed meanwhile. Reload and try again.';

// Turning 2FA on, replacing the factor (both at /confirm) and turning it
// off sign out every session (issue #172) but the request's, which gets a
// new token (reissueSession()), so the tab that made the change isn't
// logged out and a copy of its cookie is. A setup or a cancel
// changes no factor, so it revokes nothing. The others go *before* the
// write: if signing them out fails, nothing has changed, and if the write
// fails, they're signed out over a factor that didn't change, which is the
// safe way round.
//
// The session itself is checked again after the awaits too: one signed out
// meanwhile (another tab's new password) mustn't go on to change the
// factor, nor, holding no session of its own, sign out the one that
// signed it out.
const STALE_SESSION = { error: 'Not authenticated' };
export function createTotpRouter({ getSetting, setSetting }) {
  const router = Router();

  router.use(requireAuth);

  // Same settings as login's: only failed attempts count, so a stolen
  // session can't brute-force the password or a code through these.
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many attempts. Please try again later.' },
  });

  router.get('/status', (req, res) => {
    res.json({ enabled: readTotp(getSetting('totp')).enabled });
  });

  // While 2FA is on, the new secret is only pending: the active one keeps
  // working until /confirm verifies a code from the new one. The QR code
  // is drawn before anything is stored, so a setup that fails changes
  // nothing and spends no code.
  router.post('/setup', limiter, async (req, res) => {
    const totp = readTotp(getSetting('totp'));
    const check = await checkFactor(totp, getSetting('credentials'), req.body || {});
    if (check.error) return res.status(401).json({ error: check.error });

    const secret = generateSecret();
    const username = process.env.RESUMECMS_ADMIN_USERNAME || 'admin';
    const otpauthUrl = generateURI({ issuer: 'ResumeCMS', label: username, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

    const now = readTotp(getSetting('totp'));
    if (!sameFactor(now, totp)) return res.status(409).json({ error: CHANGED_ERROR });
    if (check.step !== null && isSpent(now, check.step)) return res.status(401).json({ error: FACTOR_ERROR });
    if (!isAuthenticated(req)) return res.status(401).json(STALE_SESSION);
    setSetting(
      'totp',
      totpRow(
        now.enabled
          ? { enabled: true, secret: now.secret, pendingSecret: secret, lastUsedStep: check.step }
          : { enabled: false, pendingSecret: secret },
      ),
    );
    res.json({ secret, otpauthUrl, qrDataUrl });
  });

  router.post('/confirm', limiter, async (req, res) => {
    const { token } = req.body || {};
    const totp = readTotp(getSetting('totp'));
    if (!totp.pendingSecret) {
      return res.status(409).json({ error: 'No 2FA setup in progress' });
    }
    const step = await checkCode(totp.pendingSecret, token);
    if (step === null) {
      return res.status(400).json({ error: 'Incorrect code' });
    }
    const now = readTotp(getSetting('totp'));
    if (now.pendingSecret !== totp.pendingSecret) {
      return res.status(409).json({ error: 'No 2FA setup in progress' });
    }
    if (!isAuthenticated(req)) return res.status(401).json(STALE_SESSION);
    reissueSession(req);
    // No lastUsedStep: the confirm code isn't a login, and recording it
    // would refuse the first login with the new app in the same 30 s.
    setSetting('totp', totpRow({ enabled: true, secret: totp.pendingSecret }));
    res.json({ enabled: true });
  });

  // Cancel drops the pending setup the editor shows (`secret`, so a tab
  // left open can't cancel one started since in another), leaving any
  // active factor as it is: a cancelled setup can't be confirmed later.
  // It only removes something, so the session is enough, and it answers
  // the same whether or not that secret was the pending one.
  router.post('/cancel', (req, res) => {
    const { secret } = req.body || {};
    const totp = readTotp(getSetting('totp'));
    if (typeof secret === 'string' && secret && totp.pendingSecret === secret) {
      setSetting('totp', totp.enabled ? totpRow({ ...totp, pendingSecret: null }) : null);
    }
    res.json({ enabled: totp.enabled });
  });

  router.post('/disable', limiter, async (req, res) => {
    const totp = readTotp(getSetting('totp'));
    if (totp.enabled) {
      const check = await checkFactor(totp, getSetting('credentials'), req.body || {});
      if (check.error) return res.status(401).json({ error: check.error });
      const now = readTotp(getSetting('totp'));
      if (!sameFactor(now, totp)) return res.status(409).json({ error: CHANGED_ERROR });
      if (isSpent(now, check.step)) return res.status(401).json({ error: FACTOR_ERROR });
      if (!isAuthenticated(req)) return res.status(401).json(STALE_SESSION);
      reissueSession(req);
    }
    setSetting('totp', null);
    res.json({ enabled: false });
  });

  return router;
}
