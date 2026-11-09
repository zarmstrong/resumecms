// Which dividers a list of resolved landing sections draws. A divider is
// only drawn between two things it divides: one right after another
// divider, or with no other section after it, isn't (a divider whose
// neighbours were left out: hidden, empty, or a resume that went
// private). One first in the list is drawn when something sits above it
// (`atStart`, the hero in a single column), and not otherwise. A hidden
// section, which only the editor's preview has, counts as not there. The
// server can't decide this: which sections are next to each other depends
// on the template, so LandingView applies it to the whole list for a
// template without columns, and hands it to one with columns
// (template.json's `columns`) to apply to each.
//
// On the page, a stray divider is left out; in the editor's preview
// (`preview`) it's kept, marked `stray: true`, for the preview to dim and
// say why.
export function dropStrayDividers(sections, { atStart = true, preview = false } = {}) {
  const shown = sections.filter((section) => !section.hidden);
  const stray = new Set(
    shown.filter(
      (section, i) =>
        section.kind === 'divider' &&
        ((i === 0 && !atStart) || shown[i - 1]?.kind === 'divider' || !shown.slice(i + 1).some((next) => next.kind !== 'divider'))
    )
  );
  return preview
    ? sections.map((section) => (stray.has(section) ? { ...section, stray: true } : section))
    : sections.filter((section) => !stray.has(section));
}
