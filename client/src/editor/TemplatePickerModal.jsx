import { useEffect, useRef, useState } from 'react';
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
  const previewRef = useRef(null);

  const previewSite = { ...site, template: previewTemplate, layout: previewLayout };

  // Belt-and-suspenders alongside `inert` below (every current browser
  // supports it, but this is cheap insurance regardless): strip every real
  // link/button the preview renders out of the tab order after each
  // render, since a template or content change can introduce new ones.
  useEffect(() => {
    previewRef.current?.querySelectorAll('a, button, input, select, textarea, [tabindex]').forEach((el) => {
      el.setAttribute('tabindex', '-1');
    });
  });

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

          {/* inert — this is a real ResumeView with real <a> tags
              (mailto/contact/company links); without it those would both be
              clickable (navigating away mid-browse) and sit in the dialog's
              tab order as a pile of unrelated stops. The tabindex effect
              above and pointer-events: none in CSS are redundant with
              `inert` in any current browser, but cost nothing and cover a
              browser old enough not to support it. */}
          <div className="ed-template-picker-preview" inert ref={previewRef}>
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
