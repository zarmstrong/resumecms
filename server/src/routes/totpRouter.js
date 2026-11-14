import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import { verifyPassword } from '../passwords.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { TOTP_STEP_SECONDS, TOTP_EPOCH_TOLERANCE_SECONDS } from '../totpConfig.js';

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

async function checkCode(secret, token) {
  if (typeof token !== 'string' || !secret) return null;
  const result = await verify({ secret, token, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS });
  if (!result.valid) return null;
  return Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + result.delta;
}

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
    // No lastUsedStep: the confirm code isn't a login, and recording it
    // would refuse the first login with the new app in the same 30 s.
    setSetting('totp', totpRow({ enabled: true, secret: totp.pendingSecret }));
    res.json({ enabled: true });
  });

  router.post('/disable', limiter, async (req, res) => {
    const totp = readTotp(getSetting('totp'));
    if (totp.enabled) {
      const check = await checkFactor(totp, getSetting('credentials'), req.body || {});
      if (check.error) return res.status(401).json({ error: check.error });
      const now = readTotp(getSetting('totp'));
      if (!sameFactor(now, totp)) return res.status(409).json({ error: CHANGED_ERROR });
      if (isSpent(now, check.step)) return res.status(401).json({ error: FACTOR_ERROR });
    }
    setSetting('totp', null);
    res.json({ enabled: false });
  });

  return router;
}
