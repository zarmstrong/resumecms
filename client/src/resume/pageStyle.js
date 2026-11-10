import { useEffect } from 'react';
import {
  normalizeSiteColors,
  contrastTextFor,
  contrastTextAcross,
  mixWithBlack,
  normalizePillPadding,
  PILL_PADDING_CSS,
  normalizeResumeFont,
  normalizeNameFont,
  normalizeFontSize,
  FONT_SIZE_CSS,
  normalizeLineSpacing,
  LINE_SPACING_CSS,
  normalizeFontWeight,
  FONT_WEIGHT_CSS,
  normalizeBulletStyle,
  BULLET_STYLE_CSS,
  fontCssFor,
} from './siteColors.js';

// How much of the accent the "gradient" header's far end keeps: resume.css's
// `color-mix(in srgb, var(--r-accent) 55%, black)`.
export const GRADIENT_SHADE = 0.55;

// A resume's site settings as the CSS custom properties its page (an
// `.r-page`) is styled through, plus the normalized colors. Shared by
// ResumeView and the cover letter's view (issue #71), so a letter is drawn
// in its resume's colors and fonts.
export function resumePageStyle(site) {
  const colors = normalizeSiteColors(site);
  const pillPad = PILL_PADDING_CSS[normalizePillPadding(site)];
  const style = {
    '--r-accent': colors.accent,
    '--r-heading': colors.heading,
    '--r-text': colors.text,
    '--r-bg': colors.background,
    '--font-resume': fontCssFor(normalizeResumeFont(site)),
    '--r-font-size': FONT_SIZE_CSS[normalizeFontSize(site)],
    '--r-line-spacing': LINE_SPACING_CSS[normalizeLineSpacing(site)],
    '--r-font-weight': FONT_WEIGHT_CSS[normalizeFontWeight(site)],
    '--r-bullet-style': BULLET_STYLE_CSS[normalizeBulletStyle(site)],
    // Only used by the "banner" template, which paints the header in the
    // accent color and needs readable text on top of it.
    '--r-banner-text': contrastTextFor(colors.accent),
    // The "gradient" header fades the accent into a darker shade
    // (resume.css), so its text has to read on both ends.
    '--r-gradient-text': contrastTextAcross([colors.accent, mixWithBlack(colors.accent, GRADIENT_SHADE)]),
  };
  const nameFont = normalizeNameFont(site);
  if (nameFont) style['--r-name-font'] = fontCssFor(nameFont);
  if (colors.skillsCategoryText) style['--r-skills-text'] = colors.skillsCategoryText;
  if (colors.skillsCategoryPill) {
    style['--r-skills-pill'] = colors.skillsCategoryPill;
    style['--r-skills-pad'] = pillPad;
    // Rounder than the dates pill (3px) — a category label can wrap to
    // multiple lines in the narrow label column, and a more generous
    // radius reads as a deliberate rounded "chip" in that case instead of
    // a barely-rounded rectangle.
    style['--r-skills-radius'] = '8px';
    if (!colors.skillsCategoryText) {
      style['--r-skills-text'] = contrastTextFor(colors.skillsCategoryPill);
    }
  }
  if (colors.datesText) style['--r-dates-text'] = colors.datesText;
  if (colors.datesPill) {
    style['--r-dates-pill'] = colors.datesPill;
    style['--r-dates-pad'] = pillPad;
    style['--r-dates-radius'] = '3px';
    if (!colors.datesText) {
      style['--r-dates-text'] = contrastTextFor(colors.datesPill);
    }
  }
  // Feeds the "sidebar" layout's CSS fallback (color-mix() off the accent
  // color) when unset; contrast handling for a custom background lives in
  // that layout's own component, which receives `colors` directly.
  if (colors.sidebarBackground) style['--r-sidebar-bg'] = colors.sidebarBackground;
  return { colors, style };
}

// In print/PDF output there's no card floating on the app background —
// the page's own background must fill the whole physical page, or any
// leftover space after the last block on a page shows the app's page
// color instead, producing a visible color seam at a page break.
export function usePrintBackground(mode, background) {
  useEffect(() => {
    if (mode !== 'print') return undefined;
    const prevBg = document.body.style.background;
    document.documentElement.style.background = background;
    document.body.style.background = background;
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = prevBg;
    };
  }, [mode, background]);
}
