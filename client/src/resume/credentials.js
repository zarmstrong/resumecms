import { readDate } from '../landing/dateText.js';

export const CREDENTIAL_LABELS = { license: 'License', certification: 'Certification', membership: 'Membership' };

export function credentialKindLabel(kind) {
  return Object.hasOwn(CREDENTIAL_LABELS, kind) ? CREDENTIAL_LABELS[kind] : CREDENTIAL_LABELS.certification;
}

// No base: only absolute HTTP(S) verification addresses can become links.
// The parsed href is returned, not what was typed: `https:issuer.example`
// parses here as https://issuer.example/, but as an href the browser would
// resolve the typed string against the resume's own address.
export function credentialHref(url) {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

export function credentialMeta(data) {
  const dated = (word, date) => (readDate(date) ? `${word} ${date}` : date);
  return [
    data.number && `No. ${data.number}`,
    data.issued && dated(data.kind === 'membership' ? 'Since' : 'Issued', data.issued),
    data.expires && dated('Expires', data.expires),
  ].filter(Boolean);
}
