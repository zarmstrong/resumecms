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
//   - the sections that hold nothing are dropped.
// A new contact section takes the email and phone of the draft's first
// email and phone links (a first draft has them, from the resume's header).

// Whether `section` holds anything the person wrote. A title counts unless
// it's one a preset gives a section of that kind, so switching from one
// preset to another doesn't keep the first one's empty sections.
export function sectionHasWork(section, presets) {
  const title = section.title.trim();
  const presetTitle = presets.some((preset) => preset.sections.some((s) => s.kind === section.kind && s.title === title));
  if (title && !presetTitle) return true;
  return hasContent({ ...section, title: '' });
}

// `landing` started from `preset`, as described above. `resumes` is the
// editor's list, for the resume an experience or education section reads
// (the default one); `presets` every preset, for sectionHasWork().
export function applyPreset(landing, preset, resumes, presets) {
  const current = landing.sections || [];
  const worked = current.filter((section) => sectionHasWork(section, presets));
  const used = new Set();
  const sections = preset.sections.map(({ kind, title }) => {
    const carried = worked.find((section) => section.kind === kind && !used.has(section));
    if (carried) {
      used.add(carried);
      return carried.title.trim() ? carried : { ...carried, title };
    }
    return newSection(kind, title, landing, resumes);
  });
  // Already a contact section among the preset's? Then one carried below
  // would be a second, which the server refuses.
  const hasContact = sections.some((section) => section.kind === 'contact');
  const rest = worked.filter((section) => !used.has(section) && !(hasContact && section.kind === 'contact'));
  return {
    ...landing,
    template: preset.template,
    style: structuredClone(preset.style ?? { source: 'resume', colors: {}, font: '', nameFont: '' }),
    sections: [...sections, ...rest],
  };
}

function newSection(kind, title, landing, resumes) {
  const config = SECTION_KINDS.find((k) => k.kind === kind);
  const section = { id: newSectionId(), kind, title, ...config.empty(resumes) };
  if (kind === 'contact') {
    const { email, phone } = contactFromLinks(landing);
    section.email = email;
    section.phone = phone;
  }
  return section;
}

// The address of the draft's first mailto: link and the number of its
// first tel: link (as its label shows it, else as dialled), or ''.
export function contactFromLinks(landing) {
  const links = (landing.sections || []).filter((s) => s.kind === 'links').flatMap((s) => s.links);
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
  const phone = tel ? tel.label.trim() || tel.url.slice('tel:'.length) : '';
  return { email, phone };
}

// What the person is asked before a preset replaces a page they've worked
// on: what changes, and that nothing they wrote is lost.
export function presetQuestion(preset) {
  return (
    `Start from the “${preset.label}” preset?\n\n` +
    "Its template, colors and fonts replace this page's, and its sections go first. " +
    'Sections you have written in are kept (after them, unless the preset has one of that kind), and empty ones are removed. ' +
    'Your headline, buttons and photo stay as they are. Nothing is published until you publish.'
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
