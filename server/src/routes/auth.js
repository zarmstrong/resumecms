import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { timingSafeEqual, createHash } from 'node:crypto';
import { authenticator } from 'otplib';
import { publicCaptchaConfig, verifyCaptcha } from '../captcha.js';
import { getSetting, setSetting } from '../db.js';

const router = Router();

const APP_USERNAME = process.env.RESUMECMS_ADMIN_USERNAME;
const APP_PASSWORD = process.env.RESUMECMS_APP_PASSWORD;

// otplib's default time step (also assumed by the `period=30` in the
// otpauth:// URI generated in routes/totp.js).
const TOTP_STEP_SECONDS = 30;

// Hashing both sides to a fixed length before comparing means a mismatched
// username/password length can't itself leak an early exit, and
// timingSafeEqual keeps the comparison itself from leaking how many
// leading bytes matched. Combining username+password into one hash (rather
// than two separate compares) means there's only ever one timing signal.
function credentialsMatch(candidateUsername, candidatePassword) {
  const a = createHash('sha256').update(`${candidateUsername}:${candidatePassword}`).digest();
  const b = createHash('sha256').update(`${APP_USERNAME}:${APP_PASSWORD}`).digest();
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

router.get('/status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

router.get('/captcha-config', (req, res) => {
  const totp = getSetting('totp');
  res.json({ ...publicCaptchaConfig(), totpRequired: totp?.enabled === true });
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password, captchaToken, totpToken } = req.body || {};
  if (!APP_USERNAME || !APP_PASSWORD) {
    return res.status(500).json({
      error: 'Server misconfigured: RESUMECMS_ADMIN_USERNAME/RESUMECMS_APP_PASSWORD are not set. See README for setup.',
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

  if (typeof username !== 'string' || typeof password !== 'string' || !credentialsMatch(username, password)) {
    return res.status(401).json({ error: authError });
  }

  if (totp?.enabled) {
    const delta = typeof totpToken === 'string' ? authenticator.checkDelta(totpToken, totp.secret) : null;
    if (delta === null) {
      return res.status(401).json({ error: authError });
    }
    // Reject a code already used for this or an earlier time step, so a
    // captured request (e.g. via a MITM'd network hop) can't be replayed to
    // start a second session with the same one-time code.
    const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + delta;
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

export default router;
