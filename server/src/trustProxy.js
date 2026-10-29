// Turns RESUMECMS_TRUST_PROXY into a value for Express's 'trust proxy'
// setting. Unset/empty means "don't trust X-Forwarded-For at all" (Express's
// own default). A bare integer is a hop count, and anything else (e.g.
// "loopback", "172.18.0.1", "loopback, uniquelocal") is passed through as
// Express's comma-separated list of trusted addresses/subnets. "true" is
// rejected on purpose: it trusts any client's X-Forwarded-For, which lets
// anyone dodge the login rate limit by sending a fake header.
export function parseTrustProxy(raw) {
  // Lowercased because proxy-addr only knows lowercase subnet names
  // ("loopback"), and IP addresses are case-insensitive anyway.
  const value = (raw ?? '').trim().toLowerCase();
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
      `RESUMECMS_TRUST_PROXY "${value}" mixes a hop count with addresses; use one or the other`
    );
  }
  return value;
}

// Reserved documentation addresses (RFC 5737 / RFC 3849): no real proxy
// uses them, so if the compiled setting trusts any of them it covers
// arbitrary internet clients, whatever notation it was written in (e.g.
// ::ffff:0:0/96, or 0.0.0.0/1 + 128.0.0.0/1).
const UNROUTABLE_PROBES = ['192.0.2.1', '198.51.100.1', '203.0.113.1', '2001:db8::1'];

// Applies RESUMECMS_TRUST_PROXY to an Express app. Express validates the
// address list when it's set, but its error ("invalid IP address: yes")
// doesn't say which setting caused it, so rethrow naming the variable.
export function applyTrustProxy(app, raw) {
  const value = parseTrustProxy(raw);
  try {
    app.set('trust proxy', value);
  } catch (err) {
    throw new Error(`Invalid RESUMECMS_TRUST_PROXY value "${value}": ${err.message}`, { cause: err });
  }
  // A hop count trusts whatever connects directly regardless of address, so
  // probing it would always fail; the README covers when it's safe.
  if (typeof value !== 'string') return;
  const trust = app.get('trust proxy fn');
  const matched = UNROUTABLE_PROBES.find((addr) => trust(addr, 0));
  if (matched) {
    throw new Error(
      `RESUMECMS_TRUST_PROXY "${value}" trusts arbitrary addresses (e.g. ${matched}), so any ` +
        "client could spoof X-Forwarded-For; list only your proxy's address or subnet"
    );
  }
}
