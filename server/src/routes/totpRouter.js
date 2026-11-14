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
// it reads as a pending secret with no active one.
export function readTotp(row) {
  if (!row) return { enabled: false, secret: null, pendingSecret: null };
  if (row.enabled === true) return { ...row, pendingSecret: row.pendingSecret ?? null };
  return { enabled: false, secret: null, pendingSecret: row.pendingSecret ?? row.secret ?? null };
}

async function checkCode(secret, token) {
  if (typeof token !== 'string' || !secret) return null;
  const result = await verify({ secret, token, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS });
  if (!result.valid) return null;
  return Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + result.delta;
}

// Replacing or turning off an active factor needs the current password and
// a current code from that factor, not just the session, so a stolen
// session cookie can't remove 2FA. A code already used (by login or an
// earlier change) is refused like login refuses it, but said so: right
// after a login the app still shows the code just used, and "incorrect"
// would be untrue. Returns `{ step }` to record, or `{ error }`.
async function checkActiveFactor(totp, credentials, { currentPassword, totpToken } = {}) {
  const passwordOk =
    typeof currentPassword === 'string' && !!credentials && verifyPassword(currentPassword, credentials.passwordHash);
  const step = await checkCode(totp.secret, totpToken);
  if (!passwordOk || step === null) return { error: FACTOR_ERROR };
  if (typeof totp.lastUsedStep === 'number' && step <= totp.lastUsedStep) return { error: CODE_USED_ERROR };
  return { step };
}

const FACTOR_ERROR = 'Incorrect password or code';
export const CODE_USED_ERROR = 'That code has already been used. Wait for the next one and try again.';

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
  // working until /confirm verifies a code from the new one.
  router.post('/setup', limiter, async (req, res) => {
    const totp = readTotp(getSetting('totp'));
    let lastUsedStep = totp.lastUsedStep;
    if (totp.enabled) {
      const check = await checkActiveFactor(totp, getSetting('credentials'), req.body || {});
      if (check.error) return res.status(401).json({ error: check.error });
      lastUsedStep = check.step;
    }
    const secret = generateSecret();
    setSetting(
      'totp',
      totp.enabled
        ? { enabled: true, secret: totp.secret, pendingSecret: secret, lastUsedStep }
        : { enabled: false, pendingSecret: secret },
    );

    const username = process.env.RESUMECMS_ADMIN_USERNAME || 'admin';
    const otpauthUrl = generateURI({ issuer: 'ResumeCMS', label: username, secret });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

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
    // Re-read: another request may have changed the row while verifying.
    const current = readTotp(getSetting('totp'));
    if (current.pendingSecret !== totp.pendingSecret) {
      return res.status(409).json({ error: 'No 2FA setup in progress' });
    }
    setSetting('totp', { enabled: true, secret: totp.pendingSecret, lastUsedStep: step });
    res.json({ enabled: true });
  });

  router.post('/disable', limiter, async (req, res) => {
    const totp = readTotp(getSetting('totp'));
    if (totp.enabled) {
      const check = await checkActiveFactor(totp, getSetting('credentials'), req.body || {});
      if (check.error) return res.status(401).json({ error: check.error });
    }
    setSetting('totp', null);
    res.json({ enabled: false });
  });

  return router;
}
