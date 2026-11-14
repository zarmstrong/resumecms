import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { publicCaptchaConfig, verifyCaptcha } from '../captcha.js';
import { getSetting, setSetting } from '../db.js';
import { hashPassword, verifyPassword } from '../passwords.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { verifyCode } from '../totpCode.js';

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
    const step = await verifyCode(totp.secret, totpToken);
    if (step === null) {
      return res.status(401).json({ error: authError });
    }
    // Read the row again after the await: write back only the step, onto
    // the row as it is now, and only if the factor checked is still the
    // active one, so a login finishing late can't restore a replaced or
    // disabled factor, drop a pending setup, or spend a code twice.
    const current = getSetting('totp');
    if (!current?.enabled || current.secret !== totp.secret) {
      return res.status(401).json({ error: authError });
    }
    if (typeof current.lastUsedStep === 'number' && step <= current.lastUsedStep) {
      return res.status(401).json({ error: authError });
    }
    setSetting('totp', { ...current, lastUsedStep: step });
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
