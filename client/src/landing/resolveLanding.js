// The editor's preview of the landing page (issue #70): its draft resolved
// the way a visitor will see it once published, as someone types. Mirrors
// resolveLanding() in server/src/landingFields.js (which is what the public
// site actually gets); `context` is the `context` GET /api/landing returns:
// { photoUrl, site, resumes: [{ id, href, title }] }, the resumes a card can
// link to right now.

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:'];

function isSafeUrl(url) {
  try {
    return SAFE_SCHEMES.includes(new URL(url, 'https://landing.invalid/').protocol);
  } catch {
    return false;
  }
}

export function resolveLanding(landing, context) {
  const targets = new Map((context?.resumes || []).map((r) => [r.id, r]));
  const photoUrl = landing.photo === 'custom' ? landing.photoUrl : landing.photo === 'resume' ? context?.photoUrl || '' : '';
  return {
    headline: landing.headline,
    subheadline: landing.subheadline,
    intro: landing.intro,
    photoUrl,
    links: landing.links
      .filter((link) => link.url !== '' && isSafeUrl(link.url))
      .map((link) => ({ ...(link.type ? { type: link.type } : {}), label: link.label || link.url, url: link.url })),
    resumes: landing.resumes.flatMap((card) => {
      const target = targets.get(card.resumeId);
      if (!target) return [];
      return [{ label: card.label || target.title || 'Resume', blurb: card.blurb, href: target.href }];
    }),
    site: context?.site ?? null,
  };
}

// The intro's paragraphs: plain text, a blank line between two. Rendered as
// text, never as HTML or markdown.
export function introParagraphs(intro) {
  return String(intro || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
