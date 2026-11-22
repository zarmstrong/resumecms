// Replace the resume's appearance with the same settings the standalone
// preset preview uses. Everything else belongs to the resume and stays.
export function presetSite(site, preset) {
  const {
    templateId, accent, colors, font, nameFont, fontSize, fontWeight,
    lineSpacing, pillPadding, bulletStyle, ...rest
  } = site;
  const next = {
    ...rest,
    template: preset.header,
    layout: preset.layout,
    colors: preset.colors || {},
  };
  for (const key of ['font', 'fontSize', 'lineSpacing', 'pillPadding']) {
    if (preset[key] !== undefined) next[key] = preset[key];
  }
  return next;
}

// The template picker's preset groups (issue #219): the presets named for a
// line of work first (`group: "profession"` in their template.json), then
// the rest, named for a look. Each list keeps the order it was given (the
// registry sorts by label); a group with nothing in it is left out.
export const PRESET_GROUPS = [
  { id: 'profession', title: 'By profession' },
  { id: 'look', title: 'By look' },
];

export function presetGroups(presets) {
  return PRESET_GROUPS.map((group) => ({
    ...group,
    presets: presets.filter((preset) => (preset.group === 'profession' ? 'profession' : 'look') === group.id),
  })).filter((group) => group.presets.length);
}
