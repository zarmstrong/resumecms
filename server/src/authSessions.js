import { SESSION_MAX_AGE_MS } from './sessionStore.js';

// The one place that says whether a request is logged in (issue #172).
// The cookie-session cookie holds `{ token }` and nothing else; the token
// counts only while the session store (sessionStore.js) holds it. index.js
// registers the store bound to the real database with useSessionStore();
// tests register one over ':memory:'. Until one is registered nothing is
// logged in and a login fails, so a store that never got wired up locks
// everyone out rather than letting everyone in. A cookie from before this
// (`{ authenticated: true }`) has no token, so it's simply not a login.

let sessions = null;

export function useSessionStore(store) {
  sessions = store;
}

export function hasSessionStore() {
  return !!sessions;
}

// The cookie-session options, shared by index.js and the tests.
export function sessionCookieOptions(secret) {
  return {
    name: 'resume_session',
    secret,
    maxAge: SESSION_MAX_AGE_MS,
    httpOnly: true,
    sameSite: 'lax',
  };
}

function tokenOf(req) {
  const token = req.session?.token;
  return typeof token === 'string' ? token : null;
}

export function isAuthenticated(req) {
  const token = tokenOf(req);
  return !!(sessions && token && sessions.isValid(token));
}

// A login: a fresh session in place of whatever the cookie held (its old
// session, if any, is deleted), and expired rows pruned while at it.
export function startSession(req) {
  if (!sessions) throw new Error('No session store configured');
  const old = tokenOf(req);
  if (old) sessions.remove(old);
  sessions.prune();
  req.session = { token: sessions.create() };
}

// A logout: this session's row goes, so a copy of the cookie stops working
// too, and the browser is told to drop it.
export function endSession(req) {
  const token = tokenOf(req);
  if (sessions && token) sessions.remove(token);
  req.session = null;
}

// After a change to how one logs in (password, username, 2FA): every
// session but the request's own, so the tab that made the change stays in.
export function revokeOtherSessions(req) {
  sessions?.removeOthers(tokenOf(req));
}
