import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LandingView } from '../landing/LandingView.jsx';
import { Thumbnail } from './LandingTemplatePicker.jsx';
import { presetPreviewPage } from './templateThumbnails.js';
import { applyPreset, presetSectionLabels } from './landingPresets.js';

// What the "Keep the starting page" choice is called in the picker.
// Not a folder name a preset can have (the validator takes only lowercase
// kebab-case), so no preset is ever taken for it.
export const KEEP_STARTING_PAGE = ':keep';

// The landing page's presets by profession (issue #130), as a dialog:
// every preset as a card with a thumbnail of the page it would make
// (applyPreset() on `draft`, resolved as published, with a note in place
// of each section still empty (presetPreviewPage()), and drawn by the real
// LandingView, the same thumbnails as the template picker's), its name,
// what it's for and the sections it starts with. Nothing changes until
// "Use this preset", which hands the preset to `onPick`; Cancel and Escape
// call `onClose`.
//
// `firstOpen` is the dialog the editor opens by itself on a page never
// saved or published: it adds "Keep the starting page" (the draft built
// from the resume's header, in the classic template), which `onPick`
// gets as KEEP_STARTING_PAGE, and calls its way out "Skip" (which also
// keeps it).
//
// Like the template picker, a native radio group: the arrow keys, tab stop
// and focus ring are the browser's own, and the thumbnails are inert. The
// dialog itself is a native <dialog> opened with showModal(), as the
// landing gallery's is, so the browser keeps focus inside it and makes the
// editor behind it inert; Escape reaches `onClose` through its cancel
// event, and closing gives focus back to what had it before (the "Start
// from a preset…" button).
// `keep` is applyPreset()'s `{ typed, made }`, so a thumbnail shows what
// picking it does.
//
// "Preview" on a card shows that same page full size in place of the
// list (at the dialog's width or a phone's, light or dark when the page
// has a dark palette), so a preset can be looked at properly without
// applying it: nothing is saved or changed until "Use this preset", which
// then uses the one previewed. It's a picture like the thumbnails (inert,
// so no link leaves the editor and no player loads) in a frame that
// scrolls by wheel, touch or keyboard. "Back to presets" and Escape
// return to the list, focus on that card's Preview button.
export function LandingPresetPicker({ presets, draft, context, resumes, limits, keep, scheme, firstOpen = false, onPick, onClose }) {
  const name = useId();
  const titleId = `${name}-title`;
  const [chosen, setChosen] = useState(firstOpen ? KEEP_STARTING_PAGE : presets[0]?.id);
  const [previewing, setPreviewing] = useState(null);
  const firstRadioRef = useRef(null);
  const dialogRef = useRef(null);
  const backRef = useRef(null);
  const previewButtons = useRef(new Map());
  // The card to focus once the list is back: set by leaving a preview.
  const returnTo = useRef(null);

  const options = useMemo(() => {
    const list = presets.map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      sections: presetSectionLabels(preset),
      templateId: preset.template,
      page: presetPreviewPage(applyPreset(draft, preset, resumes, presets, limits, keep), context),
    }));
    if (!firstOpen) return list;
    const page = presetPreviewPage(draft, context);
    return [
      {
        id: KEEP_STARTING_PAGE,
        label: 'Keep the starting page',
        description: 'The page made from your resume: your name and title, your links and a card for your resume, in the Classic template.',
        sections: [],
        templateId: page.template,
        page,
      },
      ...list,
    ];
    // `keep` is read as it is when the draft changes: behind the modal the
    // editor is inert, so nothing it holds changes while it's open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, draft, context, resumes, limits, firstOpen]);

  const previewed = previewing ? options.find((o) => o.id === previewing) : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal?.();
    firstRadioRef.current?.focus();
    return () => {
      if (dialog?.open) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    if (previewing) {
      backRef.current?.focus();
    } else if (returnTo.current) {
      previewButtons.current.get(returnTo.current)?.focus();
      returnTo.current = null;
    }
  }, [previewing]);

  function startPreview(id) {
    setChosen(id);
    setPreviewing(id);
  }

  function endPreview() {
    returnTo.current = previewing;
    setPreviewing(null);
  }

  // Escape: the browser would close the dialog itself; the page decides.
  // In a preview it goes back to the list first.
  function handleCancel(e) {
    e.preventDefault();
    if (previewing) endPreview();
    else onClose();
  }

  function handleUse(e) {
    e.preventDefault();
    if (chosen === KEEP_STARTING_PAGE) return onPick(KEEP_STARTING_PAGE);
    const preset = presets.find((p) => p.id === chosen);
    if (preset) onPick(preset);
  }

  return (
    <dialog ref={dialogRef} className="ed-modal ed-modal-wide ed-preset-picker" aria-labelledby={titleId} onCancel={handleCancel}>
      <form onSubmit={handleUse}>
        <div className="ed-modal-header">
          <h2 id={titleId}>{firstOpen ? 'How should your landing page start?' : 'Start from a preset'}</h2>
        </div>
        <p className="ed-preset-intro">
          {firstOpen
            ? 'Each preset is a starting point for a kind of work: a template, colors and fonts, and the sections people in that work usually want, ready to fill in. You can change all of it, and pick another preset later from “Start from a preset”.'
            : 'A preset sets the template, colors and fonts, and puts its sections first, ready to fill in. Sections you have written in are kept, and your headline, buttons and photo stay as they are.'}
        </p>
        {previewed && <PresetPreview option={previewed} scheme={scheme} backRef={backRef} onBack={endPreview} />}
        <fieldset className="ed-preset-options" hidden={Boolean(previewed)}>
          <legend className="ed-sr-only">Presets</legend>
          <div className="ed-landing-template-grid ed-preset-grid">
            {options.map((option, i) => {
              const checked = option.id === chosen;
              const descId = `${name}-${option.id}-desc`;
              return (
                <div
                  key={option.id}
                  className={`ed-landing-template${checked ? ' is-selected' : ''}`}
                  onClick={(e) => {
                    if (e.target.closest('label, button')) return;
                    setChosen(option.id);
                  }}
                >
                  <Thumbnail page={option.page} templateId={option.templateId} scheme={scheme} />
                  <label className="ed-landing-template-name">
                    <input
                      ref={i === 0 ? firstRadioRef : undefined}
                      type="radio"
                      name={name}
                      value={option.id}
                      checked={checked}
                      onChange={() => setChosen(option.id)}
                      aria-describedby={descId}
                    />
                    <span className="ed-landing-template-label">{option.label}</span>
                  </label>
                  <button
                    type="button"
                    className="ed-btn ed-btn-ghost ed-btn-sub ed-preset-preview-btn"
                    ref={(el) => {
                      if (el) previewButtons.current.set(option.id, el);
                      else previewButtons.current.delete(option.id);
                    }}
                    aria-label={`Preview ${option.label}`}
                    onClick={() => startPreview(option.id)}
                  >
                    Preview
                  </button>
                  <span id={descId} className="ed-landing-template-desc">
                    {option.description}
                    {option.sections.length > 0 && (
                      <>
                        {' '}
                        <span className="ed-preset-sections">Sections: {option.sections.join(' · ')}.</span>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </fieldset>
        <div className="ed-modal-actions">
          <button type="button" className="ed-btn ed-btn-ghost" onClick={onClose}>
            {firstOpen ? 'Skip' : 'Cancel'}
          </button>
          <button type="submit" className="ed-btn ed-btn-primary" disabled={!chosen}>
            {chosen === KEEP_STARTING_PAGE ? 'Keep it' : 'Use this preset'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

// One option's page at full size, in place of the list. Desktop is the
// dialog's own width, so a template's container queries give what a
// window that wide would; Phone is 390 px.
function PresetPreview({ option, scheme, backRef, onBack }) {
  const [width, setWidth] = useState('desktop');
  const [previewScheme, setPreviewScheme] = useState(scheme === 'dark' ? 'dark' : 'light');
  const page = option.page;
  return (
    <section className="ed-preset-preview" aria-label={`Preview: ${option.label}`}>
      <div className="ed-preset-preview-bar">
        <button type="button" ref={backRef} className="ed-btn ed-btn-ghost" onClick={onBack}>
          ← Back to presets
        </button>
        <strong className="ed-preset-preview-title">{option.label}</strong>
        <PreviewToggle
          label="Preview width"
          value={width}
          onChange={setWidth}
          choices={[
            ['desktop', 'Desktop'],
            ['phone', 'Phone'],
          ]}
        />
        {page.darkColors && (
          <PreviewToggle
            label="Preview palette"
            value={previewScheme}
            onChange={setPreviewScheme}
            choices={[
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
          />
        )}
      </div>
      <p className="ed-preset-preview-note">Nothing is changed or saved until you use this preset.</p>
      {/* Focusable so the keyboard can scroll it; the page in it is inert. */}
      <div className="ed-preset-preview-frame" tabIndex={0} role="region" aria-label={`${option.label}, as your page would look`}>
        <div className={`ed-preset-preview-page${width === 'phone' ? ' is-phone' : ''}`} inert aria-hidden="true">
          <LandingView landing={page} scheme={page.darkColors ? previewScheme : 'light'} />
        </div>
      </div>
    </section>
  );
}

function PreviewToggle({ label, value, onChange, choices }) {
  return (
    <span className="ed-landing-scheme" role="group" aria-label={label}>
      {choices.map(([id, text]) => (
        <button
          key={id}
          type="button"
          className={`ed-btn ed-btn-ghost ed-btn-sub${value === id ? ' is-active' : ''}`}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {text}
        </button>
      ))}
    </span>
  );
}
