import { useEffect, useRef, useState } from 'react';
import { ResumeView } from '../resume/ResumeView.jsx';
import { HEADER_TEMPLATES, LAYOUT_TEMPLATES, normalizeTemplate, normalizeLayout } from '../resume/templateRegistry.js';

// Real ARIA APG radio-group keyboard behavior, not just the roles: only the
// checked option is a tab stop (roving tabindex), and arrow keys both move
// focus and change the selection, wrapping at the ends — matching how a
// native <input type="radio"> group behaves.
function OptionList({ title, options, selectedId, onSelect }) {
  const buttonRefs = useRef([]);

  function handleKeyDown(e, index) {
    const forward = e.key === 'ArrowDown' || e.key === 'ArrowRight';
    const backward = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
    if (!forward && !backward) return;
    e.preventDefault();
    const nextIndex = forward ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
    onSelect(options[nextIndex].id);
    buttonRefs.current[nextIndex]?.focus();
  }

  return (
    <div className="ed-template-picker-group">
      <div className="ed-template-picker-group-title">{title}</div>
      <div className="ed-template-picker-options" role="radiogroup" aria-label={title}>
        {options.map((opt, index) => (
          <button
            key={opt.id}
            ref={(el) => (buttonRefs.current[index] = el)}
            type="button"
            role="radio"
            aria-checked={opt.id === selectedId}
            tabIndex={opt.id === selectedId ? 0 : -1}
            className={`ed-template-picker-option${opt.id === selectedId ? ' ed-template-picker-option-active' : ''}`}
            onClick={() => onSelect(opt.id)}
            onKeyDown={(e) => handleKeyDown(e, index)}
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
  // link/button the preview renders out of the tab order whenever it can
  // have rendered new ones — not on every render (this component's own
  // state changes cover it; blocks/header changing while the modal is open
  // would too, in case a debounced save/reload comes through mid-browse).
  useEffect(() => {
    previewRef.current?.querySelectorAll('a, button, input, select, textarea, [tabindex]').forEach((el) => {
      el.setAttribute('tabindex', '-1');
    });
  }, [previewTemplate, previewLayout, header, blocks]);

  function handleUse() {
    // Explicitly drop templateId (undefined is omitted by JSON.stringify)
    // rather than just spreading site — an install from before this modal
    // replaced the old preset gallery can still have it set, and PUT
    // /api/site overwrites the whole setting, so leaving it in the spread
    // would carry that dead field forward on every future save too.
    onChange({ ...site, template: previewTemplate, layout: previewLayout, templateId: undefined });
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
