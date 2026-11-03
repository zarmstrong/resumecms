// Maps a store error onto the response. Errors the store raised on purpose
// carry a `.status` (400/404/409/500) and a message meant for the caller —
// and sometimes a `.cause` (the Chromium error behind a failed publish)
// that belongs in the log. Anything else is an internal failure (SQLite,
// JSON) whose message belongs in the server log, not the response body.
export function sendError(res, err) {
  if (err && err.status) {
    if (err.cause) console.error(`${err.message}:`, err.cause);
    return res.status(err.status).json({ error: err.message });
  }
  console.error('Request failed:', err);
  return res.status(500).json({ error: 'Internal server error' });
}
