// Where an image upload (issue #92) goes once it's stored. An upload can
// take a while, and the draft keeps changing under it: a field it was
// started from may move or be gone by the time it resolves. So the
// reference is applied to the draft as it is *then*, at the right target
// or not at all: the hero photo, the share image, an image section by its
// id, and an item by its key (itemKey() below). A target that's gone drops
// the reference; the image itself is left for the store's clean-up.
//
// Targets: { kind: 'photo' }, { kind: 'seo' }, { kind: 'section', sectionId }
// and { kind: 'item', sectionId, index }, and a gallery's entry (issue #120),
// { kind: 'gallery', sectionId, index }, known by its key like an item, and
// a media section's poster (issue #121), { kind: 'poster', sectionId }.

// Items have no id, and their content can't tell them apart (two empty
// ones, or one deleted and a new one added in its place), so the editor
// knows each by the object itself: a key handed out the first time an
// upload asks, kept in a WeakMap so it never reaches the saved draft. Moving
// or removing items keeps the other objects as they are; whatever replaces
// an item with an edited copy passes its key on with carryItemKey(). One
// that doesn't (a discard, a reload) only loses the key, so an upload in
// flight for it is dropped rather than put on the wrong item.
const itemKeys = new WeakMap();
let nextKey = 1;

function itemKey(item) {
  if (!itemKeys.has(item)) itemKeys.set(item, nextKey++);
  return itemKeys.get(item);
}

// `to`, an edited copy of the item `from`, known as the same item.
export function carryItemKey(from, to) {
  if (itemKeys.has(from)) itemKeys.set(to, itemKeys.get(from));
  return to;
}

const itemsOf = (landing, sectionId) => {
  const section = landing.sections.find((s) => s.id === sectionId);
  return section?.kind === 'items' ? section.items : null;
};

const entriesOf = (landing, sectionId) => {
  const section = landing.sections.find((s) => s.id === sectionId);
  return section?.kind === 'gallery' ? section.images : null;
};

// What the upload remembers of its target, from the draft it started in
// (null when it isn't there).
export function uploadSpot(landing, target) {
  if (target.kind === 'gallery') {
    const entry = entriesOf(landing, target.sectionId)?.[target.index];
    return entry ? { target, key: itemKey(entry) } : null;
  }
  if (target.kind !== 'item') return { target };
  const item = itemsOf(landing, target.sectionId)?.[target.index];
  return item ? { target, key: itemKey(item) } : null;
}

// `landing` with the stored image `imageId` at `spot`, or null when the
// spot is gone: the hero no longer shows an uploaded photo, the section or
// the item was removed. The alt text there is kept only when it's the same
// image (the same bytes uploaded again); a different image starts with an
// empty one, so the editor's hint and the publish check ask for a
// description of *this* image instead of passing on the last one's.
export function applyUploadedImage(landing, spot, imageId) {
  if (!spot) return null;
  const { target } = spot;
  const ref = (current) => ({ imageId, alt: current?.imageId === imageId && typeof current.alt === 'string' ? current.alt : '' });
  switch (target.kind) {
    case 'photo':
      return landing.photo === 'upload' ? { ...landing, photoImage: ref(landing.photoImage) } : null;
    case 'seo':
      return { ...landing, seo: { ...landing.seo, image: ref(landing.seo?.image) } };
    case 'section': {
      const section = landing.sections.find((s) => s.id === target.sectionId);
      if (section?.kind !== 'image') return null;
      return { ...landing, sections: landing.sections.map((s) => (s === section ? { ...s, image: ref(s.image) } : s)) };
    }
    case 'poster': {
      const section = landing.sections.find((s) => s.id === target.sectionId);
      if (section?.kind !== 'media') return null;
      return { ...landing, sections: landing.sections.map((s) => (s === section ? { ...s, poster: ref(s.poster) } : s)) };
    }
    case 'item': {
      const items = itemsOf(landing, target.sectionId);
      const item = items?.find((candidate) => itemKeys.get(candidate) === spot.key);
      if (!item) return null;
      const placed = carryItemKey(item, { ...item, image: ref(item.image) });
      return {
        ...landing,
        sections: landing.sections.map((s) => (s.id === target.sectionId ? { ...s, items: s.items.map((i) => (i === item ? placed : i)) } : s)),
      };
    }
    case 'gallery': {
      const entries = entriesOf(landing, target.sectionId);
      const entry = entries?.find((candidate) => itemKeys.get(candidate) === spot.key);
      if (!entry) return null;
      const placed = carryItemKey(entry, { ...entry, image: ref(entry.image) });
      return {
        ...landing,
        sections: landing.sections.map((s) => (s.id === target.sectionId ? { ...s, images: s.images.map((e) => (e === entry ? placed : e)) } : s)),
      };
    }
    default:
      return null;
  }
}
