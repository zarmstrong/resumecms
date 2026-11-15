import { isAuthenticated } from '../authSessions.js';

// A session the store still holds and that hasn't expired (authSessions.js),
// not just a validly signed cookie.
export function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}
