const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];

// Resume link fields (company URL, header links) are free-text entered by
// whoever holds editor credentials, then rendered as `href` for every public
// visitor. React doesn't block `javascript:` URLs, so a compromised or
// malicious editor session could otherwise turn a link into stored XSS
// against anyone who clicks it.
export function safeHref(url) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    return SAFE_SCHEMES.includes(parsed.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}
