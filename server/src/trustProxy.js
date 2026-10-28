// Turns RESUMECMS_TRUST_PROXY into a value for Express's 'trust proxy'
// setting. Unset/empty means "don't trust X-Forwarded-For at all" (Express's
// own default). A bare integer is a hop count, and anything else (e.g.
// "loopback", "172.18.0.1", "loopback, uniquelocal") is passed through as
// Express's comma-separated list of trusted addresses/subnets. "true" is
// rejected on purpose: it trusts any client's X-Forwarded-For, which lets
// anyone dodge the login rate limit by sending a fake header.
export function parseTrustProxy(raw) {
  const value = (raw ?? '').trim();
  if (value === '' || value === 'false') return false;
  if (value === 'true') {
    throw new Error(
      'RESUMECMS_TRUST_PROXY=true would trust any client-supplied X-Forwarded-For header; ' +
        "set it to your proxy's address (e.g. 172.18.0.1 or loopback) or a hop count instead"
    );
  }
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}
