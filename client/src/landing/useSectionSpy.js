import { useCallback, useEffect, useRef, useState } from 'react';
import { createJumpPin, currentAnchor, scrollParent } from './sectionAnchors.js';

// Which of a table of contents' entries (sectionAnchors.js) is in view,
// for the directory landing template (issue #130), and a way to jump to
// one. Both work on whatever scrolls the page: the window, or the
// editor's preview pane (scrollParent() of `rootRef`), so the preview
// tracks and scrolls only itself, never the editor around it. Off inside
// an `[inert]` ancestor (a copy of the page drawn where nobody reads it,
// such as the editor's template thumbnails): no observers, no listeners,
// and a jump does nothing.
//
// The current one is the last whose section has begun: its top at or
// above a line 15% of the way down (at least 96 px, below where a jump
// puts a section's top, clear of a sticky bar). IntersectionObservers say
// when to look: one on the sections against the top 20% of the scroll
// area, so a top crossing the line is seen, one on the sections against
// all of it, in steps, so a fast scroll that skips the band is seen too,
// and one on `endRef`, an empty element after the last section, which
// marks the last entry once a scroll reaches it (a short last section may
// never reach the line). A jump marks its entry at once and keeps it
// marked through the scroll it starts (createJumpPin()), until the
// visitor scrolls on: by a wheel, a touch, a key or a press at once, by
// anything else (a scrollbar drag, find-in-page) once the jump's own
// scroll has settled.
export function useSectionSpy(entries, rootRef, endRef) {
  const [current, setCurrent] = useState(null);
  const pin = useRef(null);
  if (!pin.current) pin.current = createJumpPin();
  const key = entries.map((entry) => entry.anchor).join('\n');

  useEffect(() => {
    if (!entries.length || typeof IntersectionObserver === 'undefined' || isInert(rootRef.current)) return undefined;
    const root = scrollParent(rootRef.current, (node) => window.getComputedStyle(node));
    const scrolled = () => (root ? root.scrollTop : window.scrollY) > 0;
    let atEnd = false;
    const update = () => {
      const rootTop = root ? root.getBoundingClientRect().top + root.clientTop : 0;
      const height = root ? root.clientHeight : window.innerHeight;
      const topOf = (anchor) => {
        const section = document.getElementById(anchor);
        return section ? section.getBoundingClientRect().top - rootTop : undefined;
      };
      setCurrent(
        currentAnchor(entries, topOf, { line: Math.max(height * 0.15, 96), atEnd: atEnd && scrolled(), pinned: pin.current.anchor })
      );
    };

    const near = new IntersectionObserver(update, { root, rootMargin: '0px 0px -80% 0px', threshold: 0 });
    const shown = new IntersectionObserver(update, { root, threshold: [0, 0.25, 0.5, 0.75, 1] });
    for (const entry of entries) {
      const section = document.getElementById(entry.anchor);
      if (section) {
        near.observe(section);
        shown.observe(section);
      }
    }

    const end = new IntersectionObserver(
      ([change]) => {
        atEnd = change.isIntersecting;
        update();
      },
      { root, threshold: 0 }
    );
    if (endRef.current) end.observe(endRef.current);

    const scroller = root || window;
    const release = () => {
      if (pin.current.release()) update();
    };
    const onScroll = () => {
      if (pin.current.scrolled(performance.now())) update();
    };
    const byHand = ['wheel', 'touchmove', 'keydown', 'mousedown'];
    for (const type of byHand) scroller.addEventListener(type, release, { passive: true });
    scroller.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      near.disconnect();
      shown.disconnect();
      end.disconnect();
      for (const type of byHand) scroller.removeEventListener(type, release);
      scroller.removeEventListener('scroll', onScroll);
    };
    // `key` stands for `entries`, which is a new array on every render.
  }, [key, rootRef, endRef]);

  // Scrolls the section to the top of what holds the page, less its
  // scroll-margin-top (clear of a sticky bar), and marks its entry.
  const jump = useCallback(
    (anchor, { smooth = false } = {}) => {
      if (isInert(rootRef.current)) return null;
      const target = document.getElementById(anchor);
      if (!target) return null;
      const root = scrollParent(rootRef.current, (node) => window.getComputedStyle(node));
      const margin = parseFloat(window.getComputedStyle(target).scrollMarginTop) || 0;
      const offset = target.getBoundingClientRect().top - margin;
      const behavior = smooth ? 'smooth' : 'auto';
      pin.current.set(anchor, performance.now());
      if (root) root.scrollTo({ top: root.scrollTop + offset - root.getBoundingClientRect().top - root.clientTop, behavior });
      else window.scrollTo({ top: window.scrollY + offset, behavior });
      setCurrent(anchor);
      return target;
    },
    [rootRef]
  );

  return [current, jump];
}

// Inside an inert subtree, or not on the page at all.
export function isInert(el) {
  return !el || Boolean(el.closest('[inert]'));
}
