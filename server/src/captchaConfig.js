// Reads the login captcha's settings from an env object. Pure, so the
// rules can be tested without touching process.env.
//
// Captcha is off only when RESUMECMS_CAPTCHA_PROVIDER is unset or blank.
// Anything else that isn't a complete config throws, so the server
// refuses to start: falling back to "off" would quietly drop the login
// protection the operator asked for (issue #174).

const PROVIDERS = {
  turnstile: {
    siteKeyVar: 'RESUMECMS_TURNSTILE_SITE_KEY',
    secretKeyVar: 'RESUMECMS_TURNSTILE_SECRET_KEY',
    verifyUrl: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
  },
  recaptcha: {
    siteKeyVar: 'RESUMECMS_RECAPTCHA_SITE_KEY',
    secretKeyVar: 'RESUMECMS_RECAPTCHA_SECRET_KEY',
    verifyUrl: 'https://www.google.com/recaptcha/api/siteverify',
  },
};

// Returns null when captcha is off, else { provider, siteKey, secretKey,
// verifyUrl }.
export function readCaptchaConfig(env) {
  const provider = (env.RESUMECMS_CAPTCHA_PROVIDER || '').trim().toLowerCase();
  if (!provider) return null;

  const spec = Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : null;
  if (!spec) {
    throw new Error(
      `RESUMECMS_CAPTCHA_PROVIDER is "${provider}", which isn't a known provider ` +
        '(expected "turnstile" or "recaptcha"). Fix it, or unset it to turn the login captcha off.'
    );
  }

  const siteKey = (env[spec.siteKeyVar] || '').trim();
  const secretKey = (env[spec.secretKeyVar] || '').trim();
  const missing = [!siteKey && spec.siteKeyVar, !secretKey && spec.secretKeyVar].filter(Boolean);
  if (missing.length) {
    const plural = missing.length > 1;
    throw new Error(
      `RESUMECMS_CAPTCHA_PROVIDER is "${provider}" but ${missing.join(' and ')} ` +
        `${plural ? 'are' : 'is'} not set. Set ${plural ? 'them' : 'it'}, ` +
        'or unset RESUMECMS_CAPTCHA_PROVIDER to turn the login captcha off.'
    );
  }

  return { provider, siteKey, secretKey, verifyUrl: spec.verifyUrl };
}
