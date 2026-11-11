import { resolveLanding } from '../landing/resolveLanding.js';

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
