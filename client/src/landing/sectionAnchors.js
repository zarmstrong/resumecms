// The anchors the directory landing template (issue #130) links its table
// of contents to. A section's id is the editor's and never leaves the
// server publicly, so an anchor is made here, on the client, from what the
// page shows: a slug of the section's title, after a prefix that no other
// id on the page starts with, numbered when two titles slug the same
// ("Talks", "Talks" become talks and talks-2; a title that already reads
// "Talks 2" doesn't take another's). Only a section with a title gets one,
// and a divider never does (its title is a label on the rule, not a
// heading). A hidden or stray section (only in the editor's preview) gets
// none either, so the preview's anchors and contents are the page's.

export const ANCHOR_PREFIX = 'section-';

// Long enough for any real heading, short enough for a readable URL.
const MAX_SLUG = 60;

// Lowercase letters and digits of any script, accents dropped, everything
// else one hyphen; 'section' when nothing is left (a title of emoji). Cut
// by code points, so a letter outside the BMP is never split in two. A
// slug never holds two hyphens in a row, which anchorTitleId() relies on.
export function slugify(title) {
  const whole = String(title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const slug = Array.from(whole).slice(0, MAX_SLUG).join('').replace(/-+$/, '');
  return slug || 'section';
}

// The id of an anchored section's heading, for its aria-labelledby. The
// double hyphen keeps it from ever being another section's anchor.
export function anchorTitleId(anchor) {
  return `${anchor}--title`;
}

function hasEntry(section) {
  return (
    section.kind !== 'divider' &&
    !section.hidden &&
    !section.stray &&
    typeof section.title === 'string' &&
    section.title.trim() !== ''
  );
}

// The sections, each one with an entry given its `anchor`, and the table
// of contents, `{ anchor, title }` in the page's order.
export function withAnchors(sections, { prefix = ANCHOR_PREFIX } = {}) {
  const used = new Set();
  const entries = [];
  const anchored = sections.map((section) => {
    if (!hasEntry(section)) return section;
    const base = slugify(section.title);
    let slug = base;
    for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
    used.add(slug);
    const anchor = `${prefix}${slug}`;
    entries.push({ anchor, title: section.title.trim() });
    return { ...section, anchor };
  });
  return { sections: anchored, entries };
}

// The anchor a page was opened at (`#section-talks`), if it's one of these.
export function anchorFromHash(hash, entries) {
  if (typeof hash !== 'string' || !hash.startsWith('#')) return null;
  let anchor;
  try {
    anchor = decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
  return entries.some((entry) => entry.anchor === anchor) ? anchor : null;
}

// Which entry is current: the one just jumped to (`pinned`), else the last
// one once a scroll has reached the end of the page (`atEnd`; a short last
// section may never reach the line), else the last one whose section has
// begun, its top (`topOf(anchor)`, from the top of the scroll area) at or
// above `line`, else none (the hero is being read). Only ever one that's
// still there.
export function currentAnchor(entries, topOf, { line = 0, atEnd = false, pinned = null } = {}) {
  if (!entries.length) return null;
  if (pinned && entries.some((entry) => entry.anchor === pinned)) return pinned;
  if (atEnd) return entries[entries.length - 1].anchor;
  const begun = entries.findLast((entry) => {
    const top = topOf(entry.anchor);
    return typeof top === 'number' && top <= line;
  });
  return begun ? begun.anchor : null;
}

// The element whose scrolling moves `el`: the nearest ancestor that
// scrolls (the editor's preview pane) or clips it (`hidden` or `clip`: a
// box the page is drawn inside, whose outer scrolling it mustn't follow),
// or null for the window, which is what an IntersectionObserver's `root`
// takes. `styleOf` is getComputedStyle, passed in so this stays testable
// without a DOM.
export function scrollParent(el, styleOf) {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    if (node.parentElement === null) return null; // <html>: the window
    if (/^(auto|scroll|overlay|hidden|clip)$/.test(styleOf(node).overflowY)) return node;
  }
  return null;
}

// A click the page should handle as a jump: the primary button with no
// modifier. Any other (Ctrl/Cmd/Shift/Alt, a middle click) is left to the
// browser, so the entry's link can open in a new tab or window.
export function isPlainClick(event) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

// A jump's hold on the current entry (useSectionSpy.js): set by a jump and
// kept through the scroll the jump starts, then released by the next
// scroll after one `settleMs` quiet (a scrollbar drag, find-in-page,
// anything that isn't a wheel, touch, key or press). Times are passed in
// (`now`), so it needs no timers and is testable.
export function createJumpPin(settleMs = 150) {
  let anchor = null;
  let lastScroll = 0;
  return {
    get anchor() {
      return anchor;
    },
    set(next, now) {
      anchor = next;
      lastScroll = now;
    },
    release() {
      const had = anchor !== null;
      anchor = null;
      return had;
    },
    // Returns true when this scroll released it.
    scrolled(now) {
      if (anchor === null) return false;
      if (now - lastScroll < settleMs) {
        lastScroll = now;
        return false;
      }
      anchor = null;
      return true;
    },
  };
}
