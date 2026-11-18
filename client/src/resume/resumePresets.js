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
