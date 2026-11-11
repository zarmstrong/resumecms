// The editor's preview of the landing page (issue #70): its draft resolved
// the way a visitor will see it once published, as someone types. Mirrors
// resolveLanding() in server/src/landingFields.js (which is what the public
// site actually gets); `context` is the `context` GET /api/landing returns:
// { photoUrl, site, resumes: [{ id, href, title, pdfHref, experience,
// education, skills }] }, the resumes a card or hero action can link to
// right now (pdfHref '' while one has no PDF; experience the roles an
// experience section may show from it, already filtered by the server's
// experienceRoles(), and education and skills likewise by its
// educationEntries() and skillGroups()), and images:
// [{ id, src, width, height }], the uploaded images (issue #92) at the
// editor's own path, since a draft's may not be public yet. With `withIds`,
// each section keeps its id, which the server never sends: the editor's
// preview outlines a section by it. With `withHidden`, a hidden section is
// resolved too and kept as `hidden: true`, for the preview to dim; the
// server always leaves it out. Its look (issue #93) is `template`, `site`
// (context.site, or its own colors and fonts) and `darkColors`, by
// landingStyle.js's mirror of the server's. A credential (issue #119) is
// expired once context.today (today in UTC when the context doesn't say,
// as the server reads it) is past its `expires` (dateText.js): left out,
// or, `withHidden`, kept as `expired: true` for the preview to dim, and a
// section of nothing but expired ones then comes back `hidden` and
// `expired`, since the page won't show it. A media section (issue #121)
// resolves to its link as mediaUrl.js's parseMediaUrl() reads it, never the
// link itself, as the server's does.

import { darkPalette, landingSite } from './landingStyle.js';
import { hasPassed, utcToday } from './dateText.js';
import { parseMediaUrl } from './mediaUrl.js';

const SAFE_SCHEMES = ['http:', 'https:', 'mailto:', 'tel:'];

function isSafeUrl(url) {
  try {
    return SAFE_SCHEMES.includes(new URL(url, 'https://landing.invalid/').protocol);
  } catch {
    return false;
  }
}

export function resolveLanding(landing, context, { withIds = false, withHidden = false } = {}) {
  const targets = new Map((context?.resumes || []).map((r) => [r.id, r]));
  const images = new Map((context?.images || []).map((image) => [image.id, image]));
  const upload = landing.photo === 'upload' ? resolveImage(landing.photoImage, images) : null;
  const photoUrl =
    landing.photo === 'custom' ? landing.photoUrl : landing.photo === 'resume' ? context?.photoUrl || '' : (upload?.src ?? '');
  const { image: shareImage, ...seo } = landing.seo ?? {};
  const seoImage = resolveImage(shareImage, images);
  return {
    headline: landing.headline,
    subheadline: landing.subheadline,
    availability: landing.availability ?? '',
    actions: (landing.actions ?? []).flatMap((action) => {
      const shown = resolveAction(action, targets);
      return shown ? [shown] : [];
    }),
    photoUrl,
    ...(upload ? { photoAlt: upload.alt } : {}),
    sections: landing.sections.flatMap((section) => {
      const shown = section.hidden && !withHidden ? null : resolveSection(section, targets, images, { today: context?.today ?? utcToday(), withHidden });
      if (!shown) return [];
      const hidden = section.hidden ? { hidden: true } : {};
      const column = section.column ? { column: section.column } : {};
      return [{ ...(withIds ? { id: section.id } : {}), kind: section.kind, title: section.title, ...hidden, ...column, ...shown }];
    }),
    seo: { title: '', description: '', noindex: false, ...seo, ...(seoImage ? { image: seoImage } : {}) },
    template: landing.template || 'classic',
    site: landingSite(landing.style, context?.site),
    darkColors: darkPalette(landing.style),
  };
}

// What a button without a label of its own says.
export const ACTION_LABELS = { page: 'View my resume', pdf: 'Download my resume (PDF)' };

// A hero button as a visitor sees it, { label, href }, or null when it
// isn't shown: a link that's half typed or unsafe, a resume a visitor
// can't open, or a PDF it doesn't have.
function resolveAction(action, targets) {
  const icon = action.icon ? { icon: action.icon } : {};
  if (action.type === 'link') {
    return action.url !== '' && isSafeUrl(action.url) ? { label: action.label || action.url, href: action.url, ...icon } : null;
  }
  const target = targets.get(action.resumeId);
  const href = action.open === 'pdf' ? target?.pdfHref : target?.href;
  return href ? { label: action.label || ACTION_LABELS[action.open], href, ...icon } : null;
}

// An image reference ({ imageId, alt }) as a visitor sees it,
// { src, alt, width, height }, or null while its image isn't stored.
function resolveImage(ref, images) {
  const image = ref && typeof ref === 'object' ? images.get(ref.imageId) : null;
  return image ? { src: image.src, alt: typeof ref.alt === 'string' ? ref.alt : '', width: image.width, height: image.height } : null;
}

// A section as a visitor sees it, or null when nothing of it is left to
// show (the server leaves those out, heading and all).
function resolveSection(section, targets, images, { today, withHidden }) {
  switch (section.kind) {
    case 'text':
      return section.body.trim() ? { body: section.body } : null;
    case 'items': {
      const items = section.items
        .filter((item) => item.title.trim() || item.text.trim())
        .map((item) => {
          const image = resolveImage(item.image, images);
          return {
            title: item.title,
            text: item.text,
            url: item.url !== '' && isSafeUrl(item.url) ? item.url : '',
            ...(item.meta?.trim() ? { meta: item.meta } : {}),
            ...(image ? { image } : {}),
          };
        });
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
    case 'quotes': {
      const quotes = section.quotes
        .filter((quote) => quote.text.trim())
        .map((quote) => ({ text: quote.text, name: quote.name, role: quote.role, url: quote.url !== '' && isSafeUrl(quote.url) ? quote.url : '' }));
      return quotes.length ? { quotes } : null;
    }
    case 'experience': {
      const target = targets.get(section.resumeId);
      const roles = (target?.experience ?? []).slice(0, section.count).map((role) => ({
        jobTitle: role.jobTitle,
        company: role.company,
        companyUrl: role.companyUrl !== '' && isSafeUrl(role.companyUrl) ? role.companyUrl : '',
        location: role.location,
        dates: section.showDates ? roleDates(role) : '',
      }));
      return roles.length ? { roles, href: target.href } : null;
    }
    case 'image': {
      const image = resolveImage(section.image, images);
      return image ? { image, caption: section.caption } : null;
    }
    case 'divider':
      return {};
    case 'stats': {
      // A stat is its value; a label alone has nothing to show.
      const stats = section.stats.filter((stat) => stat.value.trim()).map((stat) => ({ value: stat.value, label: stat.label }));
      return stats.length ? { stats } : null;
    }
    case 'faq': {
      const entries = section.entries
        .filter((entry) => entry.question.trim() && entry.answer.trim())
        .map((entry) => ({ question: entry.question, answer: entry.answer }));
      return entries.length ? { entries } : null;
    }
    case 'education': {
      const target = targets.get(section.resumeId);
      const entries = (target?.education ?? []).slice(0, section.count).map((entry) => ({
        degree: entry.degree,
        institution: entry.institution,
        location: entry.location,
        dates: section.showDates ? roleDates(entry) : '',
      }));
      return entries.length ? { entries, href: target.href } : null;
    }
    case 'skills': {
      const target = targets.get(section.resumeId);
      const groups = (target?.skills ?? []).map((group) => ({ category: group.category, items: [...group.items] }));
      return groups.length ? { groups, href: target.href } : null;
    }
    case 'credentials': {
      const credentials = section.credentials
        .filter((credential) => credential.name.trim())
        .map((credential) => ({ credential, expired: hasPassed(credential.expires, today) }))
        .filter(({ expired }) => withHidden || !expired)
        .map(({ credential, expired }) => ({ ...resolveCredential(credential), ...(expired ? { expired: true } : {}) }));
      if (!credentials.length) return null;
      const allExpired = credentials.every((credential) => credential.expired);
      return { credentials, ...(allExpired && !section.hidden ? { hidden: true, expired: true } : {}) };
    }
    case 'gallery': {
      const shown = section.images.flatMap((entry) => {
        const image = resolveImage(entry.image, images);
        return image ? [{ image, caption: entry.caption }] : [];
      });
      return shown.length ? { images: shown } : null;
    }
    case 'media': {
      const media = parseMediaUrl(section.url);
      if (!media) return null;
      const poster = resolveImage(section.poster, images);
      return { media, caption: section.caption, transcript: section.transcript, ...(poster ? { poster } : {}) };
    }
    default:
      return null;
  }
}

function resolveCredential(credential) {
  const { kind, name, issuer, number, issued, expires, url } = credential;
  return { kind, name, issuer, number, issued, expires, url: url !== '' && isSafeUrl(url) ? url : '' };
}

function roleDates({ startDate, endDate }) {
  if (startDate && endDate) return `${startDate} – ${endDate}`;
  return startDate || endDate;
}

// A text section's paragraphs, a blank line between two. Each is rendered
// with its links and emphasis (renderInline.js), never as HTML. Mirrored by
// textParagraphs() in server/src/inlineText.js.
export function textParagraphs(text) {
  return String(text || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
