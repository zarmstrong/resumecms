// Turns RESUMECMS_TRUST_PROXY into a value for Express's 'trust proxy'
// setting. Unset/empty means "don't trust X-Forwarded-For at all" (Express's
// own default). A bare integer is a hop count, and anything else (e.g.
// "loopback", "172.18.0.1", "loopback, uniquelocal") is passed through as
// Express's comma-separated list of trusted addresses/subnets. "true" and
// catch-all subnets like 0.0.0.0/0 are rejected on purpose: they trust any
// client's X-Forwarded-For, which lets anyone dodge the login rate limit by
// sending a fake header.
export function parseTrustProxy(raw) {
  const value = (raw ?? '').trim();
  const lower = value.toLowerCase();
  if (lower === '' || lower === 'false') return false;
  if (lower === 'true') {
    throw new Error(
      'RESUMECMS_TRUST_PROXY=true would trust any client-supplied X-Forwarded-For header; ' +
        "set it to your proxy's address (e.g. 172.18.0.1 or loopback) or a hop count instead"
    );
  }
  if (/^\d+$/.test(value)) return Number(value);
  const catchAll = value
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => /\/(0|0\.0\.0\.0)$/.test(entry));
  if (catchAll) {
    throw new Error(
      `RESUMECMS_TRUST_PROXY entry "${catchAll}" matches every address, so it would trust any ` +
        "client-supplied X-Forwarded-For header; list only your proxy's address or subnet"
    );
  }
  return value;
}

// Applies RESUMECMS_TRUST_PROXY to an Express app. Express validates the
// address list when it's set, but its error ("invalid IP address: yes")
// doesn't say which setting caused it, so rethrow naming the variable.
export function applyTrustProxy(app, raw) {
  const value = parseTrustProxy(raw);
  try {
    app.set('trust proxy', value);
  } catch (err) {
    throw new Error(`Invalid RESUMECMS_TRUST_PROXY value "${raw}": ${err.message}`, { cause: err });
  }
}
