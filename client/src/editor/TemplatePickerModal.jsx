import { useState } from 'react';
import { ResumeView } from '../resume/ResumeView.jsx';
import { HEADER_TEMPLATES, LAYOUT_TEMPLATES, normalizeTemplate, normalizeLayout } from '../resume/templateRegistry.js';

function OptionList({ title, options, selectedId, onSelect }) {
  return (
    <div className="ed-template-picker-group">
      <div className="ed-template-picker-group-title">{title}</div>
      <div className="ed-template-picker-options" role="group" aria-label={title}>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            aria-pressed={opt.id === selectedId}
            className={`ed-template-picker-option${opt.id === selectedId ? ' ed-template-picker-option-active' : ''}`}
            onClick={() => onSelect(opt.id)}
          >
            <span className="ed-template-picker-option-label">{opt.label}</span>
            <span className="ed-template-picker-option-desc">{opt.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Header style and body layout are independent axes (see
// templateRegistry.js) — this modal lets you browse and mix them freely,
// previewing the combination against the resume's real content (not
// placeholder data) before committing. Nothing is written to the real
// draft until "Use this template".
export function TemplatePickerModal({ header, site, blocks, onChange, onClose }) {
  const [previewTemplate, setPreviewTemplate] = useState(normalizeTemplate(site));
  const [previewLayout, setPreviewLayout] = useState(normalizeLayout(site));

  const previewSite = { ...site, template: previewTemplate, layout: previewLayout };

  function handleUse() {
    onChange({ ...site, template: previewTemplate, layout: previewLayout });
    onClose();
  }

  return (
    <div className="ed-modal-backdrop">
      <div className="ed-modal ed-modal-wide" role="dialog" aria-modal="true" aria-labelledby="ed-template-picker-title">
        <div className="ed-modal-header">
          <h2 id="ed-template-picker-title">Choose a template</h2>
        </div>

        <div className="ed-template-picker-body">
          <div className="ed-template-picker-columns">
            <OptionList
              title="Header style"
              options={HEADER_TEMPLATES}
              selectedId={previewTemplate}
              onSelect={setPreviewTemplate}
            />
            <OptionList
              title="Body layout"
              options={LAYOUT_TEMPLATES}
              selectedId={previewLayout}
              onSelect={setPreviewLayout}
            />
          </div>

          <div className="ed-template-picker-preview">
            <div className="ed-template-picker-preview-scale">
              <ResumeView header={header} site={previewSite} blocks={blocks} mode="preview" />
            </div>
          </div>
        </div>

        <div className="ed-modal-actions">
          <button type="button" className="ed-btn ed-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ed-btn ed-btn-primary" onClick={handleUse}>
            Use this template
          </button>
        </div>
      </div>
    </div>
  );
}
