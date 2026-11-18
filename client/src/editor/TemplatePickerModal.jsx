import { useEffect, useRef, useState } from 'react';
import { ResumeView } from '../resume/ResumeView.jsx';
import { HEADER_TEMPLATES, LAYOUT_TEMPLATES, PRESETS, normalizeTemplate, normalizeLayout } from '../resume/templateRegistry.js';
import { presetSite } from '../resume/resumePresets.js';

// Real ARIA APG radio-group keyboard behavior, not just the roles: only the
// checked option (or the first if none is checked) is a tab stop, and arrow
// keys both move focus and change the selection, wrapping at the ends — matching how a
// native <input type="radio"> group behaves.
function OptionList({ title, options, selectedId, onSelect }) {
  const buttonRefs = useRef([]);
  const hasSelection = options.some((opt) => opt.id === selectedId);

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
            tabIndex={opt.id === selectedId || (!hasSelection && index === 0) ? 0 : -1}
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
// draft until "Use this template" or "Use this preset".
export function TemplatePickerModal({ header, site, blocks, onChange, onClose }) {
  const [mode, setMode] = useState('templates');
  const [presetId, setPresetId] = useState(null);
  const [previewTemplate, setPreviewTemplate] = useState(normalizeTemplate(site));
  const [previewLayout, setPreviewLayout] = useState(normalizeLayout(site));
  const previewRef = useRef(null);

  const preset = PRESETS.find((p) => p.id === presetId);
  const previewSite = mode === 'presets' && preset
    ? presetSite(site, preset)
    : { ...site, template: previewTemplate, layout: previewLayout };

  useEffect(() => {
    function handleEscape(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

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
  }, [previewTemplate, previewLayout, mode, preset, header, blocks]);

  function handleUse() {
    if (mode === 'presets') {
      if (!preset) return;
      onChange(previewSite);
      onClose();
      return;
    }
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
            <div className="ed-template-picker-modes" role="group" aria-label="Template picker mode">
              <button
                type="button"
                className={`ed-btn ${mode === 'templates' ? 'ed-btn-primary' : 'ed-btn-ghost'}`}
                aria-pressed={mode === 'templates'}
                onClick={() => setMode('templates')}
              >
                Header &amp; layout
              </button>
              <button
                type="button"
                className={`ed-btn ${mode === 'presets' ? 'ed-btn-primary' : 'ed-btn-ghost'}`}
                aria-pressed={mode === 'presets'}
                onClick={() => setMode('presets')}
              >
                Presets
              </button>
            </div>
            {mode === 'presets' ? (
              <>
                <OptionList title="Presets" options={PRESETS} selectedId={presetId} onSelect={setPresetId} />
                <p className="ed-template-picker-notice">
                  A preset replaces the template, layout, colors and type settings (fonts, size, weight, spacing, pill padding, bullet style), and keeps the title and description.
                </p>
              </>
            ) : (
              <>
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
              </>
            )}
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
          <button type="button" className="ed-btn ed-btn-primary" disabled={mode === 'presets' && !preset} onClick={handleUse}>
            {mode === 'presets' ? 'Use this preset' : 'Use this template'}
          </button>
        </div>
      </div>
    </div>
  );
}
