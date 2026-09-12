import { HeaderBlock } from './HeaderBlock.jsx';
import { BLOCK_RENDERERS } from './blockRenderers.jsx';
import './resume.css';

// mode: 'web' | 'print' | 'preview'
// 'preview' is used inside the editor and shows every block regardless of
// visibility flags, dimming the ones that are hidden from web/print.
export function ResumeView({ header, site, blocks, mode = 'web' }) {
  const isPreview = mode === 'preview';

  return (
    <div className={`r-page r-mode-${mode}`}>
      <HeaderBlock
        header={header}
        showActions={mode === 'web'}
        onPrint={() => window.print()}
        pdfHref={mode === 'web' ? '/api/public/resume.pdf' : null}
      />
      <div className="r-body">
        {blocks.map((block) => {
          const Renderer = BLOCK_RENDERERS[block.type];
          if (!Renderer) return null;

          const dimmed =
            isPreview && !(block.visibleWeb && block.visiblePrint) ? true : false;

          return (
            <div
              key={block.id}
              className={`r-block${dimmed ? ' r-block-dimmed' : ''}`}
              data-block-type={block.type}
            >
              <Renderer data={block.data} mode={mode} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
