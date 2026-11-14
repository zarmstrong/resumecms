// What the landing editor knows about each kind of section, kept out of
// LandingForm.jsx so the presets (landingPresets.js, issue #130) build
// sections the same way the "+ Add section" menu does: what each kind is
// called, what a new one starts with, a fresh id, and whether one holds
// anything the person typed (what removing it, or replacing it with a
// preset, asks about).

// The kinds of section the landing page can hold (server/src/landingFields.js's
// SECTION_KINDS), what each is called here, and what a new one starts with
// (given the editor's list of resumes).
export const SECTION_KINDS = [
  { kind: 'text', label: 'Text', addLabel: 'Text', empty: () => ({ body: '' }) },
  { kind: 'items', label: 'List', addLabel: 'List (e.g. projects)', empty: () => ({ items: [emptyItem()] }) },
  { kind: 'links', label: 'Links', addLabel: 'Links', empty: () => ({ links: [] }) },
  { kind: 'resumes', label: 'Resume cards', addLabel: 'Resume cards', empty: () => ({ cards: [] }) },
  { kind: 'quotes', label: 'Quotes', addLabel: 'Quotes (testimonials)', empty: () => ({ quotes: [emptyQuote()] }) },
  {
    kind: 'experience',
    label: 'Experience',
    addLabel: 'Experience (latest roles from a resume)',
    empty: (resumes) => ({ resumeId: (resumes.find((r) => r.isDefault) ?? resumes[0])?.id, count: 3, showDates: true }),
  },
  { kind: 'image', label: 'Image', addLabel: 'Image', empty: () => ({ image: null, caption: '' }) },
  { kind: 'divider', label: 'Divider', addLabel: 'Divider (a line between sections)', empty: () => ({}) },
  { kind: 'stats', label: 'Stats', addLabel: 'Stats (by the numbers)', empty: () => ({ stats: [emptyStat()] }) },
  { kind: 'faq', label: 'Questions and answers', addLabel: 'Questions and answers (FAQ)', empty: () => ({ entries: [emptyFaqEntry()] }) },
  {
    kind: 'education',
    label: 'Education',
    addLabel: 'Education (latest entries from a resume)',
    empty: (resumes) => ({ resumeId: (resumes.find((r) => r.isDefault) ?? resumes[0])?.id, count: 3, showDates: true }),
  },
  {
    kind: 'skills',
    label: 'Skills',
    addLabel: 'Skills (skill groups from a resume)',
    empty: (resumes) => ({ resumeId: (resumes.find((r) => r.isDefault) ?? resumes[0])?.id }),
  },
  {
    kind: 'credentials',
    label: 'Credentials',
    addLabel: 'Credentials (licenses, certifications, memberships)',
    empty: () => ({ credentials: [emptyCredential()] }),
  },
  { kind: 'gallery', label: 'Gallery', addLabel: 'Gallery (several images in a grid)', empty: () => ({ images: [] }) },
  { kind: 'media', label: 'Video or audio', addLabel: 'Video or audio (YouTube, Vimeo, SoundCloud, Spotify)', empty: () => ({ url: '', caption: '', transcript: '' }) },
  { kind: 'services', label: 'Services', addLabel: 'Services (what you offer, with prices)', empty: () => ({ services: [emptyService()] }) },
  {
    kind: 'publications',
    label: 'Publications',
    addLabel: 'Publications (papers, articles, books, talks, press)',
    empty: () => ({ order: 'manual', group: false, entries: [emptyPublication()] }),
  },
  // At most one per page (issue #124), so it's left out of the menu once there is one.
  {
    kind: 'contact',
    label: 'Contact',
    addLabel: 'Contact (email, phone, area, hours, "Save contact")',
    empty: () => ({ email: '', phone: '', area: '', address: '', hours: [], vcard: true }),
    once: true,
  },
  { kind: 'documents', label: 'Documents', addLabel: 'Documents (PDFs: a portfolio, writing samples)', empty: () => ({ documents: [] }) },
];
export const kindLabel = (kind) => SECTION_KINDS.find((k) => k.kind === kind)?.label || kind;

export function emptyItem() {
  return { title: '', text: '', url: '', meta: '' };
}

export function emptyQuote() {
  return { text: '', name: '', role: '', url: '' };
}

export function emptyStat() {
  return { value: '', label: '' };
}

export function emptyFaqEntry() {
  return { question: '', answer: '' };
}

export function emptyService() {
  return { title: '', text: '', price: '' };
}

export function emptyHours() {
  return { days: '', time: '' };
}

export function emptyCredential() {
  return { kind: 'certification', name: '', issuer: '', number: '', issued: '', expires: '', url: '' };
}

export function emptyPublication() {
  return { kind: 'article', title: '', outlet: '', date: '', url: '', doi: '', note: '' };
}

// Only tells sections apart (React keys, and the server keeps it); not
// crypto.randomUUID(), which a plain-http install's browser doesn't have.
export function newSectionId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function hasContent(section) {
  if (section.title.trim()) return true;
  switch (section.kind) {
    case 'text':
      return Boolean(section.body.trim());
    case 'items':
      return section.items.some(
        (item) => item.title.trim() || item.text.trim() || item.url.trim() || item.meta?.trim() || Boolean(item.image)
      );
    case 'links':
      return section.links.length > 0;
    case 'resumes':
      return section.cards.length > 0;
    case 'quotes':
      return section.quotes.some((quote) => quote.text.trim() || quote.name.trim() || quote.role.trim() || quote.url.trim());
    case 'experience':
      // Nothing typed but its heading: its roles come from the resume.
      return false;
    case 'image':
      return Boolean(section.image) || Boolean(section.caption.trim());
    case 'stats':
      return section.stats.some((stat) => stat.value.trim() || stat.label.trim());
    case 'faq':
      return section.entries.some((entry) => entry.question.trim() || entry.answer.trim());
    case 'education':
    case 'skills':
      // Like experience: what they show comes from the resume.
      return false;
    case 'credentials':
      return section.credentials.some((c) => [c.name, c.issuer, c.number, c.issued, c.expires, c.url].some((value) => value.trim()));
    case 'gallery':
      return section.images.some((entry) => Boolean(entry.image) || Boolean(entry.caption.trim()));
    case 'media':
      return Boolean(section.url.trim() || section.poster || section.caption.trim() || section.transcript.trim());
    case 'services':
      return section.services.some(
        (service) => service.title.trim() || service.text.trim() || service.price.trim() || service.action?.label.trim() || service.action?.url.trim()
      );
    case 'publications':
      return section.entries.some((e) => [e.title, e.outlet, e.date, e.url, e.doi, e.note].some((value) => value.trim()));
    case 'contact':
      return [section.email, section.phone, section.area, section.address].some((value) => value.trim()) || section.hours.some((h) => h.days.trim() || h.time.trim());
    case 'documents':
      return section.documents.some((entry) => Boolean(entry.file) || Boolean(entry.label.trim()) || Boolean(entry.description.trim()));
    default:
      return false;
  }
}
