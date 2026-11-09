import { locateRequest, requestSpot } from './landingAi.js';

// Where an image upload (issue #92) goes once it's stored. An upload can
// take a while, and the draft keeps changing under it: a field it was
// started from may move or be gone by the time it resolves. So the
// reference is applied to the draft as it is *then*, at a spot addressed
// the way an AI request's is (landingAi.js): the hero photo, the share
// image, an image section by its id, and an item, which has no id, by
// following it with locateRequest() (its title and text when the upload
// started). A target that's gone drops the reference; the image itself is
// left for the store's clean-up.
//
// Targets: { kind: 'photo' }, { kind: 'seo' }, { kind: 'section', sectionId }
// and { kind: 'item', sectionId, index }.

// What the upload remembers of its target, from the draft it started in.
export function uploadSpot(landing, target) {
  return target.kind === 'item' ? requestSpot(landing, target) : { target };
}

// `landing` with the stored image `imageId` at `spot`, keeping any alt text
// already there, or null when the spot is gone: the hero no longer shows
// an uploaded photo, the section was removed, the item can't be found.
export function applyUploadedImage(landing, spot, imageId) {
  const { target } = spot;
  const ref = (current) => ({ imageId, alt: typeof current?.alt === 'string' ? current.alt : '' });
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
    case 'item': {
      const located = locateRequest(landing, spot);
      if (!located) return null;
      return {
        ...landing,
        sections: landing.sections.map((s) =>
          s.id === located.sectionId ? { ...s, items: s.items.map((item, i) => (i === located.index ? { ...item, image: ref(item.image) } : item)) } : s
        ),
      };
    }
    default:
      return null;
  }
}
