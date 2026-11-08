import { HeaderBlock } from './HeaderBlock.jsx';
import { BLOCK_RENDERERS } from './blockRenderers.jsx';
import { resumePageStyle, usePrintBackground } from './pageStyle.js';
import {
  normalizeTemplate,
  normalizeLayout,
  skillsDisplayFor,
  getLayoutTemplate,
} from './templateRegistry.js';
import { blockWrapperStyle, blockWrapperClassName } from './blockStyle.js';
import { PDF_URL_PATH, pdfUrl } from './pdfUrl.js';
import './resume.css';

// mode: 'web' | 'print' | 'preview'
// 'preview' is used inside the editor and shows every block regardless of
// visibility flags, dimming the ones that are hidden from web/print.
// `highlightBlockIds` (preview only, a Set of ids) outlines blocks — the
// editor uses it to mark the blocks it's showing unsaved AI rewrites for.
// `pdfVersion` (web only) identifies the PDF on disk, from the public API;
// it cache-busts the PDF link (see pdfUrl.js). `pdfPath` is which PDF the
// link downloads: the host's public one unless given (/r/<slug> passes its
// own).
export function ResumeView({
  header,
  site,
  blocks,
  mode = 'web',
  highlightBlockIds = null,
  pdfVersion = null,
  pdfPath = PDF_URL_PATH,
}) {
  const isPreview = mode === 'preview';
  const { colors, style: colorVars } = resumePageStyle(site);
  usePrintBackground(mode, colors.background);

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
    const highlighted = isPreview && Boolean(highlightBlockIds?.has(block.id));

    return (
      <div
        key={block.id}
        className={`r-block${dimmed ? ' r-block-dimmed' : ''}${highlighted ? ' r-block-ai-preview' : ''}${blockWrapperClassName(block.data, block.type)}`}
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
        pdfHref={mode === 'web' ? pdfUrl(pdfVersion, pdfPath) : null}
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
