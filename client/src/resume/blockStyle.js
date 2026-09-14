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

// Overriding the block's own margin (via the CSS vars each block type's
// margin rule reads) isn't enough on its own: that margin still collapses
// with the *neighboring* block's margin, and CSS collapsing takes whichever
// side is larger. Most block types default to 0 top margin (only headings
// have a built-in one), so a preset spaceAbove routinely lost to the
// previous block's own 14-18px bottom margin and looked like it did
// nothing. Applying the preset as padding on the wrapper instead guarantees
// it actually shows — padding never collapses — while the paired var reset
// (forced to 0) stops this block's own default margin from *also* adding on
// top of that padding, which would otherwise double-count it.
export function blockWrapperStyle(data) {
  const style = normalizeBlockStyle(data);
  const wrapperStyle = {};
  if (BLOCK_SPACING_CSS[style.spaceAbove]) {
    wrapperStyle.paddingTop = BLOCK_SPACING_CSS[style.spaceAbove];
    wrapperStyle['--r-block-space-above'] = '0px';
  }
  if (BLOCK_SPACING_CSS[style.spaceBelow]) {
    wrapperStyle.paddingBottom = BLOCK_SPACING_CSS[style.spaceBelow];
    wrapperStyle['--r-block-space-below'] = '0px';
  }
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
