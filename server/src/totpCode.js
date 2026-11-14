import { verify } from 'otplib';
import { TOTP_EPOCH_TOLERANCE_SECONDS } from './totpConfig.js';

// Checks a TOTP code against `secret` and returns the time step it matched
// (otplib's own, so it's the step the code is for even if the clock ticks
// over while checking), or null for anything that isn't a valid code.
// otplib v13's verify() throws on a token of the wrong length or with
// anything but digits (TokenLengthError, TokenFormatError) rather than
// returning `valid: false`, so a typed "12345" must not become a 500.
export async function verifyCode(secret, token) {
  if (typeof token !== 'string' || typeof secret !== 'string' || !secret) return null;
  try {
    const result = await verify({ secret, token, epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS });
    return result.valid ? result.timeStep : null;
  } catch {
    return null;
  }
}
