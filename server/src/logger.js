import morgan from 'morgan';

// One JSON line per request to stdout — `docker compose logs` (or any log
// driver) captures it, and it's greppable/parseable with jq without needing
// a separate log file or aggregation stack.
export const accessLogger = morgan((tokens, req, res) => {
  return JSON.stringify({
    time: tokens.date(req, res, 'iso'),
    ip: tokens['remote-addr'](req, res),
    method: tokens.method(req, res),
    url: tokens.url(req, res),
    status: Number(tokens.status(req, res)),
    responseTimeMs: Number(tokens['response-time'](req, res)),
    contentLength: tokens.res(req, res, 'content-length') || 0,
    referrer: tokens.referrer(req, res) || null,
    userAgent: tokens['user-agent'](req, res) || null,
  });
});
