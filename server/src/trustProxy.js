// Turns RESUMECMS_TRUST_PROXY into a value for Express's 'trust proxy'
// setting. Unset/empty means "don't trust X-Forwarded-For at all" (Express's
// own default). A bare integer is a hop count, and anything else (e.g.
// "loopback", "172.18.0.1", "loopback, uniquelocal") is passed through as
// Express's comma-separated list of trusted addresses/subnets, trusted
// exactly as written — this doesn't try to judge whether a range is too
// broad. "true" is rejected on purpose: it trusts any client's
// X-Forwarded-For, which lets anyone dodge the login rate limit by sending a
// fake header.
export function parseTrustProxy(raw) {
  const original = (raw ?? '').trim();
  // Lowercased because proxy-addr only knows lowercase subnet names
  // ("loopback"), and IP addresses are case-insensitive anyway.
  const value = original.toLowerCase();
  if (value === '' || value === 'false') return false;
  if (value === 'true') {
    throw new Error(
      'RESUMECMS_TRUST_PROXY=true would trust any client-supplied X-Forwarded-For header; ' +
        "set it to your proxy's address (e.g. 172.18.0.1 or loopback) or a hop count instead"
    );
  }
  if (/^\d+$/.test(value)) return Number(value);
  // Inside a list, proxy-addr would silently read "1" as the IPv4 address
  // 0.0.0.1 rather than a hop count, leaving the real proxy untrusted.
  if (value.split(',').some((entry) => /^\d+$/.test(entry.trim()))) {
    throw new Error(
      `RESUMECMS_TRUST_PROXY "${original}" mixes a hop count with addresses; use one or the other`
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
    throw new Error(
      `Invalid RESUMECMS_TRUST_PROXY value "${(raw ?? '').trim()}": ${err.message}`,
      { cause: err }
    );
  }
}
