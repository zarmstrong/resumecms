import { resolveLanding } from '../landing/resolveLanding.js';
import { kindLabel } from './landingSections.js';

// The landing template picker's thumbnails (issue #130): each template drawn
// with the draft by the real LandingView, at a desktop width and scaled
// down to fit its frame, so it can never go stale like a screenshot would.

// The page box each thumbnail draws, before it's scaled: wide enough for a
// template's container queries to give its desktop arrangement, and as tall
// as the first screen of a laptop.
export const THUMBNAIL_WIDTH = 1280;
export const THUMBNAIL_HEIGHT = 800;

// How much to shrink that box to fill a frame `frameWidth` px wide (0 until
// the frame has been measured, so nothing is drawn at full size first).
export function thumbnailScale(frameWidth) {
  return frameWidth > 0 ? frameWidth / THUMBNAIL_WIDTH : 0;
}

// What a thumbnail shows: the same draft and context as the editor's
// preview, resolved as the published page will be, so hidden sections,
// expired credentials and stray dividers are left off rather than dimmed
// and labelled (those labels are for the preview, where they can be acted
// on). No ids, so nothing in it can be outlined as an AI suggestion.
export function thumbnailPage(draft, context) {
  return resolveLanding(draft, context);
}

// That page in one template.
export function withTemplate(page, templateId) {
  return { ...page, template: templateId };
}

// A key that's equal for two resolved pages exactly when they draw the
// same, so the thumbnails can skip a render when the editor re-renders for
// something else (a save finishing, a request settling) and hands down an
// equal page as a new object. The page's own `template` is left out: every
// thumbnail draws its own (withTemplate), so picking another one mustn't
// redraw them all. Nor is `seo`, which only the shell's tags read, never
// LandingView. The resolved page is plain JSON.
export function pageKey(page) {
  return page ? JSON.stringify({ ...page, template: undefined, seo: undefined }) : '';
}

// What the preset picker draws (its thumbnails and full-size preview): the
// page as published, except that a section with nothing in it yet (one a
// preset just added, mostly) isn't left out but drawn in its place as a
// short note naming it, so the preview shows every section picking the
// preset gives. A hidden section stays out, as published, and so does an
// empty divider. The note is a text section (italic), so every template
// draws it without knowing about it; only the editor ever makes one.
export function presetPreviewPage(draft, context) {
  const page = resolveLanding(draft, context, { withIds: true });
  const shown = new Map(page.sections.map((section) => [section.id, section]));
  const sections = draft.sections.flatMap((section) => {
    const resolved = shown.get(section.id);
    if (resolved) return [resolved];
    if (section.hidden || section.kind === 'divider') return [];
    return [
      {
        id: section.id,
        kind: 'text',
        title: section.title,
        body: `*${kindLabel(section.kind)}: empty until you fill it in.*`,
        ...(section.column ? { column: section.column } : {}),
      },
    ];
  });
  return { ...page, sections };
}
