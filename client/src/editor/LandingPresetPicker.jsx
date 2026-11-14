import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Thumbnail } from './LandingTemplatePicker.jsx';
import { thumbnailPage } from './templateThumbnails.js';
import { applyPreset, presetSectionLabels } from './landingPresets.js';

// What the "Keep the starting page" choice is called in the picker.
// Not a folder name a preset can have (the validator takes only lowercase
// kebab-case), so no preset is ever taken for it.
export const KEEP_STARTING_PAGE = ':keep';

// The landing page's presets by profession (issue #130), as a dialog:
// every preset as a card with a thumbnail of the page it would make
// (applyPreset() on `draft`, resolved as published and drawn by the real
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
export function LandingPresetPicker({ presets, draft, context, resumes, limits, keep, scheme, firstOpen = false, onPick, onClose }) {
  const name = useId();
  const titleId = `${name}-title`;
  const [chosen, setChosen] = useState(firstOpen ? KEEP_STARTING_PAGE : presets[0]?.id);
  const firstRadioRef = useRef(null);
  const dialogRef = useRef(null);

  const options = useMemo(() => {
    const list = presets.map((preset) => ({
      id: preset.id,
      label: preset.label,
      description: preset.description,
      sections: presetSectionLabels(preset),
      templateId: preset.template,
      page: thumbnailPage(applyPreset(draft, preset, resumes, presets, limits, keep), context),
    }));
    if (!firstOpen) return list;
    const page = thumbnailPage(draft, context);
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

  // Escape: the browser would close the dialog itself; the page decides.
  function handleCancel(e) {
    e.preventDefault();
    onClose();
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
        <fieldset className="ed-preset-options">
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
                    if (e.target.closest('label')) return;
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
