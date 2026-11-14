import { telHref } from '../resume/safeUrl.js';
import { SECTION_KINDS, hasContent, newSectionId } from './landingSections.js';

// Starting the landing page from a preset by profession (issue #130). A
// preset is a templates/landing-presets/<id>/template.json (the registry's
// LANDING_PRESETS; the validator checks each against the server's rules):
//   { id, label, description, author, template, style,
//     sections: [{ kind, title }] }
// Applying one is an ordinary edit of the draft, saved like any other, so
// the server checks it and the page counts it as an unpublished change.
//
// It changes the page's look and its sections, never its hero (headline,
// subheadline, availability, buttons, photo, cover image) or its search
// and sharing settings, and it never throws away what the person wrote:
//   - the template and the style become the preset's;
//   - the preset's sections come first, in its order: for each, the first
//     section of that kind that holds something (sectionHasWork()) is
//     carried over as it is, its title kept unless it has none, and
//     otherwise a new one starts the way "+ Add section" starts one
//     (SECTION_KINDS' `empty`), with the preset's title;
//   - every other section that holds something follows, in its order;
//   - the sections that hold nothing are dropped;
//   - should that come to more sections than a page may have (`limits`,
//     the server's LANDING_LIMITS), the preset's new, empty ones are left
//     out from its end until it fits; what's carried always fits, since
//     the draft did.
// A new contact section takes the email and phone of the draft's first
// email and phone links in a section that isn't hidden (a first draft
// has them, from the resume's header), so nothing hidden is made public.

// The kinds whose content comes from a resume (nothing typed in them but
// a title), so they're never empty on the page.
const RESUME_KINDS = ['experience', 'education', 'skills'];
// What a style starts with, so one a preset gives only in part (the
// validator allows that, as the server does) is whole in the draft, as
// the Look fields expect.
const EMPTY_STYLE = { source: 'resume', colors: { accent: '', heading: '', text: '', background: '' }, font: '', nameFont: '' };

// What a page may hold when the editor's limits don't say (the server's
// LANDING_LIMITS, which GET /api/landing sends as `limits`).
const FALLBACK_LIMITS = { sections: 20, contactEmail: 254, contactPhone: 40 };

// Whether `section` holds anything the person wrote or set. A title
// counts unless the section is one a preset made (its id in `made`, see
// presetMadeIds()) and the title is a preset's for that kind, so switching
// from one preset to another doesn't keep the first one's empty sections,
// while a heading the person typed counts whatever it says; hiding it or
// putting it in the side column counts, and so
// does any setting set otherwise than a new section of its kind starts it:
// one of the section's ("Save contact" off, publications newest first) or
// of an entry's (a credential's kind a license). An experience, education
// or skills section always counts: it shows what its resume holds, however
// it was set up. So does one whose id is in `typed`: the editor's fields
// that hold text only on screen (a media link half typed, an AI
// instruction) name their section there.
export function sectionHasWork(section, presets, resumes, { typed = EMPTY_SET, made = EMPTY_SET } = {}) {
  if (RESUME_KINDS.includes(section.kind) || typed.has(section.id)) return true;
  const title = section.title.trim();
  const presetTitle = made.has(section.id) && presets.some((preset) => preset.sections.some((s) => s.kind === section.kind && s.title === title));
  if (title && !presetTitle) return true;
  if (section.hidden || section.column) return true;
  const fresh = SECTION_KINDS.find((k) => k.kind === section.kind)?.empty(resumes) ?? {};
  const differs = Object.entries(fresh).some(([key, value]) => {
    if (Array.isArray(value)) {
      // Each entry against a new one (a list starts with one, or none).
      const start = value[0];
      return isRecord(start) && Array.isArray(section[key]) && section[key].some((entry) => isRecord(entry) && settingsDiffer(start, entry));
    }
    return value === null || typeof value !== 'object' ? scalarDiffers(value, section[key]) : false;
  });
  return differs || hasContent({ ...section, title: '' });
}

const EMPTY_SET = new Set();
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// A value that isn't a list or an object, set otherwise than it starts
// (one left out, as the server leaves out an empty item's `meta`, isn't).
function scalarDiffers(start, now) {
  if ((start !== null && typeof start === 'object') || now === undefined) return false;
  return typeof start === 'string' && typeof now === 'string' ? now.trim() !== start.trim() : now !== start;
}

// Whether an entry's own settings (not its lists, which hasContent()
// reads) are set otherwise than a new entry's, or it has one a new entry
// doesn't (a service's button, stored only once added).
function settingsDiffer(start, entry) {
  const changed = Object.entries(start).some(([key, value]) => !Array.isArray(value) && scalarDiffers(value, entry[key]));
  return changed || Object.keys(entry).some((key) => !(key in start) && entry[key] != null);
}

// `landing` started from `preset`, as described above. `resumes` is the
// editor's list, for the resume an experience or education section reads
// (the default one); `presets` every preset, for sectionHasWork();
// `limits` the editor's (GET /api/landing's), for the caps; `typed` and
// `made` sectionHasWork()'s.
export function applyPreset(landing, preset, resumes, presets, limits = FALLBACK_LIMITS, { typed = EMPTY_SET, made = EMPTY_SET } = {}) {
  const caps = { ...FALLBACK_LIMITS, ...limits };
  const current = landing.sections || [];
  const worked = current.filter((section) => sectionHasWork(section, presets, resumes, { typed, made }));
  // `used`: the draft's sections taken into the preset's slots; `created`:
  // the new ones, the only ones the cap below may leave out (a carried one
  // may be a copy, given the preset's title, so it's never told apart by
  // identity with the draft's).
  const used = new Set();
  const created = new Set();
  const sections = preset.sections.map(({ kind, title }) => {
    const carried = worked.find((section) => section.kind === kind && !used.has(section));
    if (carried) {
      used.add(carried);
      return carried.title.trim() ? carried : { ...carried, title };
    }
    const section = newSection(kind, title, landing, resumes, caps);
    created.add(section);
    return section;
  });
  // Already a contact section among the preset's? Then one carried below
  // would be a second, which the server refuses.
  const hasContact = sections.some((section) => section.kind === 'contact');
  const rest = worked.filter((section) => !used.has(section) && !(hasContact && section.kind === 'contact'));
  // Over the cap: the preset's new sections go, last first.
  let over = sections.length + rest.length - caps.sections;
  for (let i = sections.length - 1; over > 0 && i >= 0; i--) {
    if (created.has(sections[i])) {
      sections.splice(i, 1);
      over--;
    }
  }
  // The preset's look; a dark palette of the person's own stays unless the
  // preset brings one.
  const given = structuredClone(preset.style ?? {});
  const style = { ...structuredClone(EMPTY_STYLE), ...given, colors: { ...EMPTY_STYLE.colors, ...given.colors } };
  if (!style.darkColors && landing.style?.darkColors) style.darkColors = structuredClone(landing.style.darkColors);
  return {
    ...landing,
    template: preset.template,
    style,
    sections: [...sections, ...rest],
  };
}

// The ids of the sections applyPreset() made going from `before` to
// `after`, for the editor to keep as `made` (by id, which an edit keeps).
export function presetMadeIds(before, after) {
  const had = new Set((before.sections || []).map((section) => section.id));
  return (after.sections || []).filter((section) => !had.has(section.id)).map((section) => section.id);
}

function newSection(kind, title, landing, resumes, caps) {
  const config = SECTION_KINDS.find((k) => k.kind === kind);
  const section = { id: newSectionId(), kind, title, ...config.empty(resumes) };
  if (kind === 'contact') {
    const { email, phone } = contactFromLinks(landing, caps);
    section.email = email;
    section.phone = phone;
  }
  return section;
}

// The address of the draft's first mailto: link and the number of its
// first tel: link, from links sections that aren't hidden, or '' (and ''
// for one longer than a contact section takes). The number is the one the
// link dials; its label only when that's the same number written out
// ("(555) 010-0199" for tel:+15550100199), never a label like "Call me".
export function contactFromLinks(landing, limits = FALLBACK_LIMITS) {
  const caps = { ...FALLBACK_LIMITS, ...limits };
  const links = (landing.sections || []).filter((s) => s.kind === 'links' && !s.hidden).flatMap((s) => s.links);
  const mail = links.find((link) => /^mailto:[^?]+$/i.test(link.url));
  const tel = links.find((link) => /^tel:/i.test(link.url));
  let email = '';
  if (mail) {
    try {
      email = decodeURIComponent(mail.url.slice('mailto:'.length));
    } catch {
      email = '';
    }
  }
  let phone = '';
  if (tel) {
    let dialled = tel.url.slice('tel:'.length);
    try {
      dialled = decodeURIComponent(dialled);
    } catch {
      // kept as written
    }
    // The link's number written the way a contact field takes it (an
    // extension as " x12", which telHref() reads back as ;ext=12), and
    // the link that field makes: the page has to dial what the link did.
    const ext = dialled.match(/;ext=(\d+)$/i);
    const written = ext ? `${dialled.slice(0, ext.index)} x${ext[1]}` : dialled;
    const target = telHref(written);
    const label = tel.label.trim();
    phone = !target ? '' : label && telHref(label) === target ? label : written;
  }
  return { email: contactLine(email, caps.contactEmail), phone: contactLine(phone, caps.contactPhone) };
}

// Fits a contact section's single-line field of `max` characters, else ''.
function contactLine(value, max) {
  return value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : '';
}

// What the person is asked before a preset replaces a page they've worked
// on: what changes, and that nothing they wrote is lost.
// `suggestions` is how many AI suggestions are open: one for a section the
// preset removes is dropped with it.
export function presetQuestion(preset, { suggestions = 0 } = {}) {
  return (
    `Start from the “${preset.label}” preset?\n\n` +
    "Its template, colors and fonts replace this page's (a dark palette of your own stays), and its sections go first. " +
    'Sections you have written in are kept (after them, unless the preset has one of that kind), and empty ones are removed. ' +
    'Your headline, buttons and photo stay as they are. Nothing is published until you publish.' +
    (suggestions > 0
      ? `\n\n${suggestions === 1 ? 'An AI suggestion is' : `${suggestions} AI suggestions are`} still open: one for a section that's removed goes with it.`
      : '')
  );
}

// Whether the landing editor offers the presets as it opens: the install
// has never saved a draft (it sees the one built from the default resume's
// header) and never published one.
export function offerPresetsOnOpen(status) {
  return Boolean(status) && status.hasDraft === false && !status.publishedAt;
}

// The kinds of a preset's sections, as the picker lists them.
export function presetSectionLabels(preset) {
  return preset.sections.map(({ kind, title }) => title || SECTION_KINDS.find((k) => k.kind === kind)?.label || kind);
}
