import { STATUS_CODES } from 'node:http';
import { ERROR } from '../cacheHeaders.js';

// The app's last middleware (registered after mountClient() in index.js):
// whatever reached next(err) without being answered (express.json()
// refusing malformed JSON or a body over its limit, a throw past handle(),
// a static-file failure) gets the API's { error } JSON instead of Express's
// default HTML page, which carries a stack trace outside production.
//
// A client error keeps its status (body-parser's 400 entity.parse.failed,
// 413 entity.too.large, ...) with a message of our own for the common
// ones: a JSON parse error's text quotes the body back. Anything else is a
// 500 whose details belong in the server log, as in routes/sendError.js.
const MESSAGES = {
  'entity.parse.failed': 'The request body is not valid JSON',
  'entity.too.large': 'The request body is too large',
};

export function errorHandler(err, req, res, next) {
  // Too late to answer: let Express close the connection.
  if (res.headersSent) return next(err);
  const status = err?.status ?? err?.statusCode;
  res.set('Cache-Control', ERROR);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const message = MESSAGES[err.type] ?? (err.expose && err.message ? err.message : STATUS_CODES[status] ?? 'Bad request');
    return res.status(status).json({ error: message });
  }
  console.error('Request failed:', err);
  return res.status(500).json({ error: 'Internal server error' });
}
