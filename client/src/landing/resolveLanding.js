// The editor's preview of the landing page (issue #70): its draft resolved
// the way a visitor will see it once published, as someone types. Mirrors
// resolveLanding() in server/src/landingFields.js (which is what the public
// site actually gets); `context` is the `context` GET /api/landing returns:
// { photoUrl, site, resumes: [{ id, href, title, pdfHref }] }, the resumes a
// card or hero action can link to right now (pdfHref '' while one has no
// PDF). With `withIds`, each section keeps its id, which
// the server never sends: the editor's preview outlines a section by it.

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

function isSafeUrl(url) {
  try {
    return SAFE_SCHEMES.includes(new URL(url, 'https://landing.invalid/').protocol);
  } catch {
    return false;
  }
}

export function resolveLanding(landing, context, { withIds = false } = {}) {
  const targets = new Map((context?.resumes || []).map((r) => [r.id, r]));
  const photoUrl = landing.photo === 'custom' ? landing.photoUrl : landing.photo === 'resume' ? context?.photoUrl || '' : '';
  return {
    headline: landing.headline,
    subheadline: landing.subheadline,
    availability: landing.availability ?? '',
    actions: (landing.actions ?? []).flatMap((action) => {
      const shown = resolveAction(action, targets);
      return shown ? [shown] : [];
    }),
    photoUrl,
    sections: landing.sections.flatMap((section) => {
      const shown = resolveSection(section, targets);
      return shown ? [{ ...(withIds ? { id: section.id } : {}), kind: section.kind, title: section.title, ...shown }] : [];
    }),
    seo: { title: '', description: '', noindex: false, ...landing.seo },
    site: context?.site ?? null,
  };
}

// What a button without a label of its own says.
export const ACTION_LABELS = { page: 'View my resume', pdf: 'Download my resume (PDF)' };

// A hero button as a visitor sees it, { label, href }, or null when it
// isn't shown: a link that's half typed or unsafe, a resume a visitor
// can't open, or a PDF it doesn't have.
function resolveAction(action, targets) {
  if (action.type === 'link') {
    return action.url !== '' && isSafeUrl(action.url) ? { label: action.label || action.url, href: action.url } : null;
  }
  const target = targets.get(action.resumeId);
  const href = action.open === 'pdf' ? target?.pdfHref : target?.href;
  return href ? { label: action.label || ACTION_LABELS[action.open], href } : null;
}

// A section as a visitor sees it, or null when nothing of it is left to
// show (the server leaves those out, heading and all).
function resolveSection(section, targets) {
  switch (section.kind) {
    case 'text':
      return section.body.trim() ? { body: section.body } : null;
    case 'items': {
      const items = section.items
        .filter((item) => item.title.trim() || item.text.trim())
        .map((item) => ({ title: item.title, text: item.text, url: item.url !== '' && isSafeUrl(item.url) ? item.url : '' }));
      return items.length ? { items } : null;
    }
    case 'links': {
      const links = section.links
        .filter((link) => link.url !== '' && isSafeUrl(link.url))
        .map((link) => ({ ...(link.type ? { type: link.type } : {}), label: link.label || link.url, url: link.url }));
      return links.length ? { links } : null;
    }
    case 'resumes': {
      const cards = section.cards.flatMap((card) => {
        const target = targets.get(card.resumeId);
        if (!target) return [];
        const pdfHref = card.showPdf && target.pdfHref ? { pdfHref: target.pdfHref } : {};
        return [{ label: card.label || target.title || 'Resume', blurb: card.blurb, href: target.href, ...pdfHref }];
      });
      return cards.length ? { cards } : null;
    }
    default:
      return null;
  }
}

// A text section's paragraphs: plain text, a blank line between two. Rendered as
// text, never as HTML or markdown.
export function textParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
