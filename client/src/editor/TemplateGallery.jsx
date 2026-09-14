import { ResumeView } from '../resume/ResumeView.jsx';
import { sampleHeader, sampleBlocks } from '../resume/sampleResume.js';
import { PRESETS } from '../resume/templateRegistry.js';
import { normalizeSiteColors } from '../resume/siteColors.js';

// Each card is a real, live ResumeView fed placeholder data — never the
// user's actual draft — scaled down with CSS. Always accurate since it's
// the same rendering path as the real resume, not a cached screenshot.
function TemplateCard({ preset, active, onUse }) {
  const site = {
    template: preset.header,
    layout: preset.layout,
    colors: preset.colors,
    font: preset.font,
    fontSize: preset.fontSize,
    lineSpacing: preset.lineSpacing,
    pillPadding: preset.pillPadding,
  };

  return (
    <div className={`ed-template-card${active ? ' ed-template-card-active' : ''}`}>
      <div className="ed-template-card-preview">
        <div className="ed-template-card-scale">
          <ResumeView header={sampleHeader} site={site} blocks={sampleBlocks} mode="preview" />
        </div>
      </div>
      <div className="ed-template-card-info">
        <div className="ed-template-card-label">{preset.label}</div>
        <div className="ed-template-card-description">{preset.description}</div>
        <div className="ed-template-card-actions">
          <a
            className="ed-btn ed-btn-ghost ed-btn-sub"
            href={`/template-preview/preset/${preset.id}`}
            target="_blank"
            rel="noreferrer"
          >
            Open full size
          </a>
          <button type="button" className="ed-btn ed-btn-primary ed-btn-sub" onClick={onUse} disabled={active}>
            {active ? 'In use' : 'Use this template'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TemplateGallery({ site, onChange }) {
  const colors = normalizeSiteColors(site);

  function useTemplate(preset) {
    onChange({
      ...site,
      template: preset.header,
      layout: preset.layout,
      colors: { ...colors, ...(preset.colors || {}) },
      font: preset.font || site.font,
      fontSize: preset.fontSize || site.fontSize,
      lineSpacing: preset.lineSpacing || site.lineSpacing,
      pillPadding: preset.pillPadding || site.pillPadding,
      templateId: preset.id,
    });
  }

  return (
    <div className="ed-template-gallery">
      {PRESETS.map((preset) => (
        <TemplateCard
          key={preset.id}
          preset={preset}
          active={site?.templateId === preset.id}
          onUse={() => useTemplate(preset)}
        />
      ))}
    </div>
  );
}
