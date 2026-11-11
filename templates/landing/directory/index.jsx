import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { anchorFromHash, isPlainClick, withAnchors } from '@landing/sectionAnchors.js';
import { isInert, useSectionSpy } from '@landing/useSectionSpy.js';

// Directory (issue #130), for a long page: the hero across the top, then a
// table of contents beside the sections that stays in view and marks the
// section being read. Its entries are the titled sections (not dividers),
// linked by anchors made from their titles (sectionAnchors.js), since a
// section's id never leaves the server. On a narrow page (a container
// query in style.css, so the editor's preview shows what a phone would)
// the contents fold into a "Jump to" menu at the top of the screen, closed
// again by a jump, Escape, a click outside it or focus leaving it.
//
// A plain click on an entry scrolls whatever holds the page, the window or
// the editor's preview pane (useSectionSpy.js, which also marks the entry
// in view), and moves focus to the section; smoothly only under
// prefers-reduced-motion: no-preference. A modified or middle click is the
// browser's (a new tab). On the page a jump also puts the anchor in the
// address bar (replacing the entry, so Back still leaves the page); in the
// preview it never touches the editor's URL. The preview's anchors carry a
// prefix of their own (useId()), so nothing else in the editor can share
// their ids.
//
// Drawn inside an `[inert]` ancestor (the editor's template thumbnails,
// which draw the page with `preview` false), it's a picture only: ids
// prefixed like the preview's (set before the first paint), and no
// tracking, listeners, hash jump or address bar change.
export default function DirectoryLanding({ landing, renderHero, renderSection, preview }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const mainRef = useRef(null);
  const [isolated, setIsolated] = useState(false);
  useLayoutEffect(() => {
    if (!preview && isInert(mainRef.current)) setIsolated(true);
  }, [preview]);
  const local = preview || isolated;
  const prefix = local ? `preview-${uid}-section-` : undefined;
  const { sections, entries } = withAnchors(landing.sections, { prefix });
  const listId = local ? `preview-${uid}-contents` : 'l-directory-contents';

  const navRef = useRef(null);
  const endRef = useRef(null);
  const toggleRef = useRef(null);
  const [current, jumpTo] = useSectionSpy(entries, navRef, endRef);
  const [open, setOpen] = useState(false);

  // A page opened at one of its anchors (a shared link): the sections come
  // in after the first paint, too late for the browser's own jump. Only on
  // mount: the page is fetched before it's drawn.
  useEffect(() => {
    if (preview || isInert(mainRef.current)) return;
    const anchor = anchorFromHash(window.location.hash, entries);
    if (anchor) jumpTo(anchor);
  }, []);

  // The open menu closes on a press anywhere outside it.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!navRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const jump = (event, anchor) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    const smooth = window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches;
    const target = jumpTo(anchor, { smooth });
    if (!target) return;
    target.focus({ preventScroll: true });
    setOpen(false);
    if (!local) window.history.replaceState(window.history.state, '', `#${anchor}`);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape' && open) {
      setOpen(false);
      toggleRef.current?.focus();
    }
  };

  // Focus moving out of the menu (Tab past its last entry) closes it.
  const onBlur = (event) => {
    if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };

  const currentTitle = entries.find((entry) => entry.anchor === current)?.title;

  return (
    <main ref={mainRef} className={`l-directory${entries.length ? '' : ' l-directory-plain'}`}>
      <div className="l-directory-head">{renderHero()}</div>
      <div className="l-directory-body">
        {entries.length > 0 && (
          <nav
            ref={navRef}
            className={`l-directory-toc${open ? ' l-directory-open' : ''}`}
            aria-label="On this page"
            onKeyDown={onKeyDown}
            onBlur={onBlur}
          >
            <p className="l-directory-toc-title" aria-hidden="true">
              On this page
            </p>
            <button
              ref={toggleRef}
              type="button"
              className="l-directory-toggle"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((was) => !was)}
            >
              <span className="l-directory-toggle-label">Jump to</span>
              {currentTitle && <span className="l-directory-toggle-current">{currentTitle}</span>}
              <span className="l-directory-toggle-mark" aria-hidden="true" />
            </button>
            <ol id={listId} className="l-directory-list">
              {entries.map((entry) => (
                <li key={entry.anchor}>
                  <a
                    className="l-directory-link"
                    href={`#${entry.anchor}`}
                    aria-current={entry.anchor === current ? 'location' : undefined}
                    onClick={(event) => jump(event, entry.anchor)}
                  >
                    {entry.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}
        <div className="l-directory-content">
          <div className="l-main">{sections.map(renderSection)}</div>
          <div ref={endRef} className="l-directory-end" />
        </div>
      </div>
    </main>
  );
}
