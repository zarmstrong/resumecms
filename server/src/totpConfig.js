// otplib's default time step. routes/totp.js doesn't pass `period` to
// generateURI(), so authenticator apps assume this same 30s default from
// the otpauth:// URI rather than it being stated explicitly.
export const TOTP_STEP_SECONDS = 30;

// otplib v13 defaults to epochTolerance: 0 (current 30s period only), which
// is stricter than v12's `authenticator` preset (window: 1, i.e. ±1 step).
// Matching the old ±1-step tolerance here keeps codes valid despite minor
// clock drift or network delay, same as before the v13 upgrade.
export const TOTP_EPOCH_TOLERANCE_SECONDS = TOTP_STEP_SECONDS;
