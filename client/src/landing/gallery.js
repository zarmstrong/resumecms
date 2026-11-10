// The enlarged view of a gallery section (issue #120, LandingGallery.jsx),
// the pure part: where a key moves it among `count` images, from `index`.
// The arrow keys go to the previous or next image, wrapping around at either
// end, Home and End to the first and last; any other key is null, so the
// dialog leaves it alone (Tab, Escape, Enter on a button).
export function galleryStep(index, count, key) {
  if (count < 1) return null;
  switch (key) {
    case 'ArrowLeft':
      return (index - 1 + count) % count;
    case 'ArrowRight':
      return (index + 1) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

// What the view says of the image it shows, for its live region: its place
// and its description, e.g. "Image 2 of 5: A wedding cake".
export function galleryAnnouncement(index, count, alt) {
  const text = typeof alt === 'string' ? alt.trim() : '';
  return `Image ${index + 1} of ${count}${text ? `: ${text}` : ''}`;
}
