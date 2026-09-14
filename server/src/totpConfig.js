// otplib's default time step (also assumed by the `period=30` in the
// otpauth:// URI generated in routes/totp.js).
export const TOTP_STEP_SECONDS = 30;

// otplib v13 defaults to epochTolerance: 0 (current 30s period only), which
// is stricter than v12's `authenticator` preset (window: 1, i.e. ±1 step).
// Matching the old ±1-step tolerance here keeps codes valid despite minor
// clock drift or network delay, same as before the v13 upgrade.
export const TOTP_EPOCH_TOLERANCE_SECONDS = TOTP_STEP_SECONDS;
