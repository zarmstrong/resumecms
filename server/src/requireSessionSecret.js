import { checkSessionSecret, SessionSecretError } from './sessionSecret.js';

// Imported first by index.js, so it runs before db.js opens and seeds the
// database or anything listens: a bad secret exits with the message alone.
function readSecret() {
  try {
    return checkSessionSecret(process.env.RESUMECMS_SESSION_SECRET);
  } catch (error) {
    if (!(error instanceof SessionSecretError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}

export const SESSION_SECRET = readSecret();
