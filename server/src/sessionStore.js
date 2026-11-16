import { createHash, randomBytes } from 'node:crypto';

// Editor logins kept server-side (issue #172), so one can be revoked: the
// cookie carries only a random token, and a request is logged in only while
// the `sessions` table (schema.js) holds that token's hash and it hasn't
// expired. Over a database handle, so tests run it on ':memory:'; index.js
// binds it to the real one and hands it to authSessions.js.

// 30 days from login, never extended. The cookie's maxAge is the same
// (authSessions.js), but only this one is enforced.
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;
// base64url of TOKEN_BYTES, so anything else is refused before a lookup.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const isToken = (token) => typeof token === 'string' && TOKEN_PATTERN.test(token);

export function createSessionStore(db, { now = Date.now, maxAgeMs = SESSION_MAX_AGE_MS } = {}) {
  const insertRow = db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)');
  const selectRow = db.prepare('SELECT created_at, expires_at FROM sessions WHERE token_hash = ?');
  const deleteRow = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const deleteOthers = db.prepare('DELETE FROM sessions WHERE token_hash != ?');
  const deleteAll = db.prepare('DELETE FROM sessions');
  const deleteExpired = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  // A new session's token, to put in the cookie. The token itself is never
  // stored.
  function create() {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const at = now();
    insertRow.run(hashToken(token), at, at + maxAgeMs);
    return token;
  }

  // A new token for `token`'s live session, with its login time and expiry,
  // so a rotation never extends a login; the old token still works until
  // the caller removes it. Null when `token` isn't a live session.
  function replace(token) {
    if (!isValid(token)) return null;
    const row = selectRow.get(hashToken(token));
    const next = randomBytes(TOKEN_BYTES).toString('base64url');
    insertRow.run(hashToken(next), row.created_at, row.expires_at);
    return next;
  }

  // Whether `token` is a live session. An expired one is deleted as it's
  // refused.
  function isValid(token) {
    if (!isToken(token)) return false;
    const hash = hashToken(token);
    const row = selectRow.get(hash);
    if (!row) return false;
    if (row.expires_at <= now()) {
      deleteRow.run(hash);
      return false;
    }
    return true;
  }

  function remove(token) {
    if (isToken(token)) deleteRow.run(hashToken(token));
  }

  // Every session but `token`'s. Without a well-formed token that's all of
  // them, so a caller that lost track of its own errs toward signing out.
  function removeOthers(token) {
    if (isToken(token)) deleteOthers.run(hashToken(token));
    else deleteAll.run();
  }

  function prune() {
    deleteExpired.run(now());
  }

  return { create, replace, isValid, remove, removeOthers, prune };
}
