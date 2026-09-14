// Per-block customization (extra spacing, highlight) lives in `block.data.style`
// rather than its own DB column, so no migration is needed — `data` is
// already a freeform JSON blob and unset fields change nothing.

export const BLOCK_SPACING_CSS = {
  small: '12px',
  medium: '24px',
  large: '40px',
  xlarge: '64px',
};

export const BLOCK_SPACING_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra large' },
];

export function normalizeBlockStyle(data) {
  return (data && data.style) || {};
}

// Setting margin directly on the block wrapper only ever grows the gap —
// it collapses with the child element's own top/bottom margin (e.g. a
// heading's built-in 30px top margin) to whichever is larger, so a preset
// smaller than that built-in margin has no visible effect. To let a preset
// shrink the gap too, these are instead passed down as CSS custom
// properties that each block type's own margin rule in resume.css reads
// (falling back to that type's current default when unset) — replacing the
// margin outright rather than competing with it.
export function blockWrapperStyle(data) {
  const style = normalizeBlockStyle(data);
  const wrapperStyle = {};
  if (BLOCK_SPACING_CSS[style.spaceAbove]) wrapperStyle['--r-block-space-above'] = BLOCK_SPACING_CSS[style.spaceAbove];
  if (BLOCK_SPACING_CSS[style.spaceBelow]) wrapperStyle['--r-block-space-below'] = BLOCK_SPACING_CSS[style.spaceBelow];
  return wrapperStyle;
}

export function blockWrapperClassName(data) {
  return normalizeBlockStyle(data).highlight ? ' r-block-highlight' : '';
}

// Section headings default to a small "eyebrow" size (see .r-heading in
// resume.css) that reads as smaller than the body text it introduces —
// `medium` below is what that default was bumped to. Sized in em so it
// still scales with the site-wide font size setting.
export const HEADING_SIZE_CSS = {
  small: '0.8125em',
  medium: '1em',
  large: '1.1875em',
  xlarge: '1.375em',
};

export const DEFAULT_HEADING_SIZE = 'medium';

export const HEADING_SIZE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra large' },
];

export function headingFontSize(data) {
  const size = data && data.fontSize;
  return HEADING_SIZE_CSS[size] || HEADING_SIZE_CSS[DEFAULT_HEADING_SIZE];
}
