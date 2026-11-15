// The session secret signs the cookie-session cookie, and requireAuth only
// checks `req.session.authenticated`, so anyone who knows the secret can sign
// their own login (issue #171). The server therefore refuses to start with a
// missing, short or published one: the strings below have all shipped in
// this repo as defaults or examples, so they're as good as public.
export const SESSION_SECRET_MIN_LENGTH = 32;

export const PLACEHOLDER_SECRETS = [
  'dev-secret-change-me',
  'please-change-this-session-secret',
  'change-this-to-a-long-random-string',
  'devsecret',
];

const HOW_TO = 'Generate one with `openssl rand -hex 32`.';

export class SessionSecretError extends Error {}

// Returns the secret as given, or throws a SessionSecretError saying what's
// wrong with it. Pure: requireSessionSecret.js reads the env and exits.
export function checkSessionSecret(value) {
  const secret = typeof value === 'string' ? value : '';
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new SessionSecretError(`RESUMECMS_SESSION_SECRET is not set. ${HOW_TO}`);
  }
  if (PLACEHOLDER_SECRETS.includes(trimmed.toLowerCase())) {
    throw new SessionSecretError(
      `RESUMECMS_SESSION_SECRET is still the published placeholder "${trimmed}". ${HOW_TO}`
    );
  }
  if (trimmed.length < SESSION_SECRET_MIN_LENGTH) {
    throw new SessionSecretError(
      `RESUMECMS_SESSION_SECRET is shorter than ${SESSION_SECRET_MIN_LENGTH} characters. ${HOW_TO}`
    );
  }
  return secret;
}
