import { useEffect } from 'react';
import { HeaderBlock } from './HeaderBlock.jsx';
import { BLOCK_RENDERERS } from './blockRenderers.jsx';
import {
  normalizeSiteColors,
  contrastTextFor,
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
import {
  normalizeTemplate,
  normalizeLayout,
  skillsDisplayFor,
  getLayoutTemplate,
} from './templateRegistry.js';
import { blockWrapperStyle, blockWrapperClassName } from './blockStyle.js';
import './resume.css';

// mode: 'web' | 'print' | 'preview'
// 'preview' is used inside the editor and shows every block regardless of
// visibility flags, dimming the ones that are hidden from web/print.
export function ResumeView({ header, site, blocks, mode = 'web' }) {
  const isPreview = mode === 'preview';
  const colors = normalizeSiteColors(site);
  const pillPad = PILL_PADDING_CSS[normalizePillPadding(site)];
  const colorVars = {
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
  };
  const nameFont = normalizeNameFont(site);
  if (nameFont) colorVars['--r-name-font'] = fontCssFor(nameFont);
  if (colors.skillsCategoryText) colorVars['--r-skills-text'] = colors.skillsCategoryText;
  if (colors.skillsCategoryPill) {
    colorVars['--r-skills-pill'] = colors.skillsCategoryPill;
    colorVars['--r-skills-pad'] = pillPad;
    // Rounder than the dates pill (3px) — a category label can wrap to
    // multiple lines in the narrow label column, and a more generous
    // radius reads as a deliberate rounded "chip" in that case instead of
    // a barely-rounded rectangle.
    colorVars['--r-skills-radius'] = '8px';
    if (!colors.skillsCategoryText) {
      colorVars['--r-skills-text'] = contrastTextFor(colors.skillsCategoryPill);
    }
  }
  if (colors.datesText) colorVars['--r-dates-text'] = colors.datesText;
  if (colors.datesPill) {
    colorVars['--r-dates-pill'] = colors.datesPill;
    colorVars['--r-dates-pad'] = pillPad;
    colorVars['--r-dates-radius'] = '3px';
    if (!colors.datesText) {
      colorVars['--r-dates-text'] = contrastTextFor(colors.datesPill);
    }
  }
  // Feeds the "sidebar" layout's CSS fallback (color-mix() off the accent
  // color) when unset; contrast handling for a custom background lives in
  // that layout's own component, which receives `colors` directly.
  if (colors.sidebarBackground) colorVars['--r-sidebar-bg'] = colors.sidebarBackground;

  // In print/PDF output there's no card floating on the app background —
  // the resume's own background must fill the whole physical page, or any
  // leftover space after the last block on a page shows the app's page
  // color instead, producing a visible color seam at a page break.
  useEffect(() => {
    if (mode !== 'print') return undefined;
    const prevBg = document.body.style.background;
    document.documentElement.style.background = colors.background;
    document.body.style.background = colors.background;
    return () => {
      document.documentElement.style.background = '';
      document.body.style.background = prevBg;
    };
  }, [mode, colors.background]);

  const layout = normalizeLayout(site);
  const LayoutComponent = getLayoutTemplate(layout).Component;
  const skillsDisplay = skillsDisplayFor(site);

  // Layouts may pass `{ style }` to add inline styles to the block wrapper
  // (split-columns uses it for a flex `order`) without adding an extra
  // element that would break `.r-block:first-child` spacing rules.
  function renderBlock(block, { style } = {}) {
    const Renderer = BLOCK_RENDERERS[block.type];
    if (!Renderer) return null;
    // The public API keeps blocks hidden in this mode as content-free
    // placeholders (server/src/publicBlocks.js) so column layouts group and
    // classify the same list the editor preview does; they render nothing.
    if (block.hidden) return null;

    const dimmed = isPreview && !(block.visibleWeb && block.visiblePrint);

    return (
      <div
        key={block.id}
        className={`r-block${dimmed ? ' r-block-dimmed' : ''}${blockWrapperClassName(block.data)}`}
        data-block-type={block.type}
        style={style ? { ...blockWrapperStyle(block.data), ...style } : blockWrapperStyle(block.data)}
      >
        <Renderer data={block.data} mode={mode} skillsDisplay={skillsDisplay} />
      </div>
    );
  }

  return (
    <div className={`r-page r-mode-${mode} r-layout-${layout}`} style={colorVars}>
      <HeaderBlock
        header={header}
        showActions={mode === 'web'}
        onPrint={() => window.print()}
        pdfHref={mode === 'web' ? '/api/public/resume.pdf' : null}
        template={normalizeTemplate(site)}
      />
      {LayoutComponent ? (
        <LayoutComponent blocks={blocks} renderBlock={renderBlock} mode={mode} colors={colors} />
      ) : (
        <div className="r-body">{blocks.map(renderBlock)}</div>
      )}
    </div>
  );
}
