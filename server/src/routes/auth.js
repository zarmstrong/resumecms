import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { verify } from 'otplib';
import { publicCaptchaConfig, verifyCaptcha } from '../captcha.js';
import { getSetting, setSetting } from '../db.js';
import { hashPassword, verifyPassword } from '../passwords.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { TOTP_STEP_SECONDS, TOTP_EPOCH_TOLERANCE_SECONDS } from '../totpConfig.js';

const router = Router();

// Hashing to a fixed length before comparing means a mismatched username
// length can't itself leak an early exit, and timingSafeEqual keeps the
// comparison itself from leaking how many leading bytes matched.
function usernameMatches(candidateUsername, actualUsername) {
  const a = createHash('sha256').update(String(candidateUsername)).digest();
  const b = createHash('sha256').update(actualUsername).digest();
  return timingSafeEqual(a, b);
}

// Brute-force protection: only failed attempts count against the limit, so
// a legitimate user who logs in successfully is never penalized.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Please try again later.' },
});

// Same idea as loginLimiter, applied to credential changes so a stolen
// session cookie can't be used to brute-force the current password.
const credentialsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many attempts. Please try again later.' },
});

router.get('/status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

router.get('/captcha-config', (req, res) => {
  const totp = getSetting('totp');
  res.json({ ...publicCaptchaConfig(), totpRequired: totp?.enabled === true });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, captchaToken, totpToken } = req.body || {};
  const credentials = getSetting('credentials');
  if (!credentials) {
    return res.status(500).json({
      error: 'Server misconfigured: no login credentials configured. See README for setup.',
    });
  }

  const captchaOk = await verifyCaptcha(captchaToken, req.ip);
  if (!captchaOk) {
    return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  }

  const totp = getSetting('totp');
  // Same generic message whether the username/password or the TOTP code was
  // wrong — a distinct message per failure mode would let an attacker use
  // the response text to confirm a guessed password before ever supplying a
  // valid second factor, defeating the point of requiring one.
  const authError = totp?.enabled ? 'Incorrect username, password, or code' : 'Incorrect username or password';

  // Both sides are always evaluated (no short-circuit on the username check)
  // so a mismatched username can't be distinguished, by timing, from a
  // mismatched password.
  const usernameOk = typeof username === 'string' && usernameMatches(username, credentials.username);
  const passwordOk = typeof password === 'string' && verifyPassword(password, credentials.passwordHash);
  if (!usernameOk || !passwordOk) {
    return res.status(401).json({ error: authError });
  }

  if (totp?.enabled) {
    const result =
      typeof totpToken === 'string'
        ? await verify({ secret: totp.secret, token: totpToken, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS })
        : { valid: false };
    if (!result.valid) {
      return res.status(401).json({ error: authError });
    }
    // Reject a code already used for this or an earlier time step, so a
    // captured request (e.g. via a MITM'd network hop) can't be replayed to
    // start a second session with the same one-time code.
    const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + result.delta;
    if (typeof totp.lastUsedStep === 'number' && step <= totp.lastUsedStep) {
      return res.status(401).json({ error: authError });
    }
    setSetting('totp', { ...totp, lastUsedStep: step });
  }

  req.session.authenticated = true;
  return res.json({ authenticated: true });
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.json({ authenticated: false });
});

router.get('/credentials', requireAuth, (req, res) => {
  const credentials = getSetting('credentials');
  res.json({ username: credentials?.username || '' });
});

router.post('/credentials', requireAuth, credentialsLimiter, (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body || {};
  const credentials = getSetting('credentials');
  if (!credentials) {
    return res.status(500).json({ error: 'Server misconfigured: no login credentials configured.' });
  }
  if (!verifyPassword(currentPassword, credentials.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  if (typeof newUsername !== 'string' || !newUsername.trim()) {
    return res.status(400).json({ error: 'Username cannot be empty.' });
  }
  if (newPassword !== undefined && newPassword !== '' && (typeof newPassword !== 'string' || newPassword.length < 8)) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const updated = {
    username: newUsername.trim(),
    passwordHash: newPassword ? hashPassword(newPassword) : credentials.passwordHash,
  };
  setSetting('credentials', updated);
  res.json({ username: updated.username });
});

export default router;
