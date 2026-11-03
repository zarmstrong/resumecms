import { createHash, timingSafeEqual } from 'node:crypto';

// Bearer-token gate for the MCP endpoint. The token comes from
// RESUMECMS_MCP_TOKEN; when it's unset the endpoint answers 404 so an
// unconfigured install doesn't advertise it. There's deliberately no rate
// limiter here: one keyed on the client IP would, behind a reverse proxy
// without `trust proxy`, let any stranger lock the real agent out for 15
// minutes — so instead the token must be long enough that guessing is
// hopeless, and a short one is refused outright (treated as unset). Failed
// attempts are logged instead, and every tool call is logged by
// mcp/createMcpServer.js, so misuse of a leaked token leaves a trail.
export const MCP_TOKEN_MIN_LENGTH = 32;

// Hashing to a fixed length before comparing means a mismatched token
// length can't itself leak an early exit (timingSafeEqual throws on
// unequal lengths), and timingSafeEqual keeps the comparison itself from
// leaking how many leading bytes matched — same trick as routes/auth.js.
function tokenMatches(candidate, actual) {
  const a = createHash('sha256').update(String(candidate)).digest();
  const b = createHash('sha256').update(actual).digest();
  return timingSafeEqual(a, b);
}

export function createMcpAuth(rawToken, { log = console } = {}) {
  // Trim so a trailing newline from an .env file can't make the token
  // unmatchable.
  const configured = (rawToken || '').trim();
  let token = configured;
  if (configured && configured.length < MCP_TOKEN_MIN_LENGTH) {
    log.error(
      `RESUMECMS_MCP_TOKEN is shorter than ${MCP_TOKEN_MIN_LENGTH} characters; ` +
        'the MCP endpoint stays disabled until it is replaced with a longer random token.'
    );
    token = '';
  }

  return function mcpAuth(req, res, next) {
    if (!token) return res.status(404).json({ error: 'Not found' });

    const match = /^Bearer\s+(.+)$/i.exec(req.headers?.authorization || '');
    const candidate = match ? match[1].trim() : '';
    if (candidate && tokenMatches(candidate, token)) return next();

    // The token is the only thing standing between the network and full
    // editor access, so every rejected attempt is worth a log line: a burst
    // of them is how a leaked or guessed token would first show up. `ip` is
    // the peer address, which behind a reverse proxy is the proxy's (Express
    // only unwraps it when `trust proxy` is set), so the X-Forwarded-For
    // header is recorded as received, too — unverified, but it's what lets
    // an attack behind nginx/Traefik be attributed or filtered.
    log.warn(
      JSON.stringify({
        time: new Date().toISOString(),
        event: 'mcp_auth_failed',
        ip: req.ip ?? req.socket?.remoteAddress ?? null,
        forwardedFor: req.headers?.['x-forwarded-for'] ?? null,
        reason: candidate ? 'wrong token' : 'no bearer token',
      })
    );
    res.set('WWW-Authenticate', 'Bearer realm="resumecms-mcp"');
    res.set('Cache-Control', 'no-store');
    return res.status(401).json({ error: 'Not authenticated' });
  };
}
