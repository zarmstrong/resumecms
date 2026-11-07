const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

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

// A link's href plus, for anything but an email or phone link (which open
// the mail app or dialer as is), the attributes that open it in a new tab.
export function linkProps(url) {
  const external = !/^\s*(mailto|tel):/i.test(url || '');
  return { href: safeHref(url), ...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {}) };
}

// A phone number as typed ("+1 (555) 555-0100 x12") as a tel: URL
// ("tel:+15555550100;ext=12"): its digits, a leading + kept, and a trailing
// extension. Undefined when there are no digits to dial. Mirrored by
// telUrl() in server/src/landingFields.js.
export function telHref(phone) {
  const text = typeof phone === 'string' ? phone.trim() : '';
  // No two quantifiers here can take the same characters, so a long run of
  // spaces can't make the match backtrack for seconds.
  const ext = text.match(/(?:ext\.?|x|#)\s*(\d+)$/i);
  const number = ext ? text.slice(0, ext.index) : text;
  const digits = number.replace(/\D/g, '');
  if (!digits || /[a-z#]/i.test(number)) return undefined;
  return `tel:${number.startsWith('+') ? '+' : ''}${digits}${ext ? `;ext=${ext[1]}` : ''}`;
}
