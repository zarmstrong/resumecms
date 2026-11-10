import { useRef, useState } from 'react';
import { galleryAnnouncement, galleryStep } from './gallery.js';

// A gallery section (issue #120): its images, as resolveLanding() gives them
// ([{ image: { src, alt, width, height }, caption }]), in a grid, each a
// button that opens it larger in a modal <dialog>. The dialog keeps focus
// (the rest of the page is inert while it's open), Escape, the close button
// and a click beside the image close it, the arrow keys (and the two
// buttons) move between the images (gallery.js), and closing puts focus back
// on the thumbnail of the image it showed last. It shows the caption and the
// description (the alt text, for everyone; screen readers hear it once, from
// the image). Thumbnails carry their stored size and load lazily, so the grid
// doesn't jump while they arrive. Captions are plain text.
export function LandingGallery({ images, label }) {
  const dialogRef = useRef(null);
  const thumbRefs = useRef([]);
  const [shown, setShown] = useState(null);
  const count = images.length;
  // The editor's preview may drop images while the view is open.
  const index = shown === null || count === 0 ? null : Math.min(shown, count - 1);
  const current = index === null ? null : images[index];

  function open(i) {
    setShown(i);
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }

  function close() {
    dialogRef.current?.close();
  }

  // After any way of closing (Escape included); runs after the browser has
  // put focus back on the thumbnail that opened it, so this one wins.
  function handleClose() {
    const last = index;
    setShown(null);
    if (last !== null) thumbRefs.current[last]?.focus();
  }

  // A click on the dialog itself, not on what's in it, is beside the image.
  function handleClick(e) {
    if (e.target === e.currentTarget) close();
  }

  function handleKeyDown(e) {
    if (index === null) return;
    const next = galleryStep(index, count, e.key);
    if (next === null) return;
    e.preventDefault();
    setShown(next);
  }

  // One element, so the editor preview's dimming of a hidden section
  // (.l-section-hidden > *) never reaches the dialog itself.
  return (
    <div className="l-gallery-wrap">
      <ul className="l-gallery">
        {images.map((entry, i) => (
          <li key={i} className="l-gallery-item">
            <figure className="l-gallery-figure">
              <button
                type="button"
                className="l-gallery-open"
                ref={(el) => {
                  thumbRefs.current[i] = el;
                }}
                onClick={() => open(i)}
                aria-haspopup="dialog"
                aria-label={entry.image.alt.trim() ? undefined : `Image ${i + 1}`}
              >
                <img
                  className="l-gallery-image"
                  src={entry.image.src}
                  alt={entry.image.alt}
                  width={entry.image.width}
                  height={entry.image.height}
                  loading="lazy"
                  decoding="async"
                />
              </button>
              {entry.caption && <figcaption className="l-gallery-caption">{entry.caption}</figcaption>}
            </figure>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialogRef}
        className="l-gallery-dialog"
        aria-label={label || 'Gallery'}
        onClose={handleClose}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      >
        {current && (
          <div className="l-gallery-view">
            <div className="l-gallery-bar">
              <span className="l-gallery-count" aria-hidden="true">
                {index + 1} / {count}
              </span>
              <span className="l-gallery-live" aria-live="polite">
                {galleryAnnouncement(index, count, current.image.alt)}
              </span>
              <button type="button" className="l-gallery-button l-gallery-close" onClick={close} aria-label="Close">
                ×
              </button>
            </div>
            <figure className="l-gallery-view-figure">
              <img
                className="l-gallery-view-image"
                src={current.image.src}
                alt={current.image.alt}
                width={current.image.width}
                height={current.image.height}
              />
              {(current.caption || current.image.alt.trim()) && (
                <figcaption className="l-gallery-view-caption">
                  {current.caption && <span className="l-gallery-view-text">{current.caption}</span>}
                  {current.image.alt.trim() && current.image.alt !== current.caption && (
                    <span className="l-gallery-view-alt" aria-hidden="true">
                      {current.image.alt}
                    </span>
                  )}
                </figcaption>
              )}
            </figure>
            {count > 1 && (
              <div className="l-gallery-nav">
                <button type="button" className="l-gallery-button" onClick={() => setShown(galleryStep(index, count, 'ArrowLeft'))} aria-label="Previous image">
                  ←
                </button>
                <button type="button" className="l-gallery-button" onClick={() => setShown(galleryStep(index, count, 'ArrowRight'))} aria-label="Next image">
                  →
                </button>
              </div>
            )}
          </div>
        )}
      </dialog>
    </div>
  );
}
