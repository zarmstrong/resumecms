import { useState } from 'react';
import { DEFAULT_TAILOR_TYPES, TAILOR_TYPES, tailorItems } from './tailorRun.js';
import { DEFAULT_HIDE_FROM, HIDE_FROM_LABELS } from './tailorPlan.js';

// The brief behind AI tailoring (issue #53; the server checks it in
// ai/brief.js) plus which block types to tailor. The fields are shared by
// "Tailor…" (TailorModal, below) and the New resume dialog's "Tailor the
// copy" section. `limits` is the AI settings' briefLimits. The form also
// holds the tailoring plan's options (issue #84, editor/tailorPlan.js):
// whether to ask what to hide (`hide`, from `hideFrom`) and for a section
// order (`order`).

export function emptyTailorForm(tailoring, { hide = false } = {}) {
  return {
    audience: tailoring?.audience || '',
    posting: tailoring?.posting || '',
    guidance: tailoring?.guidance || '',
    types: DEFAULT_TAILOR_TYPES,
    hide,
    order: false,
    hideFrom: DEFAULT_HIDE_FROM,
  };
}

// The plan the form asks for ({ hide, order, hideFrom }), or null for none.
export function tailorPlanOptions(form) {
  return form.hide || form.order ? { hide: form.hide, order: form.order, hideFrom: form.hideFrom } : null;
}

// The submit button's count: "3 rewrites", "3 rewrites and suggestions",
// "suggestions"; null when the form asks for nothing.
export function tailorRequestsLabel(count, plan) {
  const rewrites = count ? `${count} rewrite${count === 1 ? '' : 's'}` : '';
  if (!plan) return rewrites || null;
  return rewrites ? `${rewrites} and suggestions` : 'suggestions';
}

export function tailorBrief(form) {
  return { audience: form.audience.trim(), posting: form.posting.trim(), guidance: form.guidance.trim() };
}

// How many requests the form's choices make for `blocks` (null: unknown).
export function tailorCount(form, blocks) {
  return blocks ? tailorItems(blocks, form.types).length : null;
}

// The brief's own fields: who it's for, the posting and extra guidance.
// Also used by a cover letter's AI draft (editor/LetterAiPanels.jsx), with
// `form` holding just those three.
export function BriefFields({ form, onChange, limits, idPrefix, disabled = false }) {
  const set = (key) => (e) => onChange({ ...form, [key]: e.target.value });
  return (
    <>
      <div className="ed-field">
        <label htmlFor={`${idPrefix}-audience`}>Who is it for?</label>
        <input
          id={`${idPrefix}-audience`}
          className="ed-input"
          value={form.audience}
          onChange={set('audience')}
          placeholder="e.g. security engineering roles"
          maxLength={limits?.audience}
          disabled={disabled}
        />
      </div>
      <div className="ed-field">
        <label htmlFor={`${idPrefix}-posting`}>Job posting (optional)</label>
        <textarea
          id={`${idPrefix}-posting`}
          className="ed-textarea"
          rows={5}
          value={form.posting}
          onChange={set('posting')}
          placeholder="Paste the posting to tailor for one job"
          maxLength={limits?.posting}
          disabled={disabled}
        />
        {limits?.posting && form.posting.length > limits.posting * 0.9 && (
          <span className="ed-field-hint">
            {form.posting.length.toLocaleString()} of {limits.posting.toLocaleString()} characters
          </span>
        )}
      </div>
      <div className="ed-field">
        <label htmlFor={`${idPrefix}-guidance`}>Anything else? (optional)</label>
        <textarea
          id={`${idPrefix}-guidance`}
          className="ed-textarea"
          rows={2}
          value={form.guidance}
          onChange={set('guidance')}
          placeholder="e.g. Lead with incident response"
          maxLength={limits?.guidance}
          disabled={disabled}
        />
      </div>
    </>
  );
}

// The plan's options: suggest what to hide (and where from), suggest a
// section order.
export function PlanFields({ form, onChange, idPrefix, disabled = false }) {
  const check = (key) => (e) => onChange({ ...form, [key]: e.target.checked });
  return (
    <fieldset className="ed-field ed-tailor-types" disabled={disabled}>
      <legend>Leave out and reorder</legend>
      <label className="ed-checkbox-field">
        <input type="checkbox" checked={form.hide} onChange={check('hide')} />
        Suggest what to hide
      </label>
      {form.hide && (
        <div className="ed-tailor-hide-from" role="radiogroup" aria-label="Hide from">
          <span>Hide from:</span>
          {Object.entries(HIDE_FROM_LABELS).map(([value, label]) => (
            <label key={value} className="ed-checkbox-field">
              <input
                type="radio"
                name={`${idPrefix}-hide-from`}
                checked={form.hideFrom === value}
                onChange={() => onChange({ ...form, hideFrom: value })}
              />
              {label}
            </label>
          ))}
        </div>
      )}
      <label className="ed-checkbox-field">
        <input type="checkbox" checked={form.order} onChange={check('order')} />
        Suggest a section order
      </label>
    </fieldset>
  );
}

export function TailorFields({ form, onChange, limits, idPrefix, disabled = false }) {
  const toggle = (type) => (e) =>
    onChange({ ...form, types: e.target.checked ? [...form.types, type] : form.types.filter((t) => t !== type) });
  return (
    <>
      <BriefFields form={form} onChange={onChange} limits={limits} idPrefix={idPrefix} disabled={disabled} />
      <fieldset className="ed-field ed-tailor-types" disabled={disabled}>
        <legend>Sections to tailor</legend>
        {TAILOR_TYPES.map(({ type, label }) => (
          <label key={type} className="ed-checkbox-field">
            <input type="checkbox" checked={form.types.includes(type)} onChange={toggle(type)} />
            {label}
          </label>
        ))}
      </fieldset>
      <PlanFields form={form} onChange={onChange} idPrefix={idPrefix} disabled={disabled} />
      <span className="ed-field-hint">
        Each section gets its own AI rewrite to review; nothing is saved until you accept it. Tailoring changes what's stressed
        and how it's worded, never the facts.
        {form.hide && ' Suggestions of what to hide come first, and sections they suggest hiding aren’t rewritten. Hiding never deletes anything.'}
      </span>
    </>
  );
}

// "Tailor…" for the open resume, pre-filled with the brief it was last
// tailored for. `onTailor(brief, types, plan)` saves the brief and starts
// the run (EditorPage's); this closes once it has. With `planOnly` it's
// "Suggest what to hide…": the plan alone, no rewrites, for a resume
// that's already tailored.
export function TailorModal({ resume, blocks, limits, planOnly = false, onTailor, onClose }) {
  const [form, setForm] = useState(() => emptyTailorForm(resume.tailoring, { hide: planOnly }));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const plan = tailorPlanOptions(form);
  const count = planOnly ? 0 : tailorCount(form, blocks);
  const requests = tailorRequestsLabel(count, plan);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onTailor(tailorBrief(form), planOnly ? [] : form.types, plan);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-modal-backdrop">
      <form className="ed-modal" role="dialog" aria-modal="true" aria-labelledby="ed-tailor-title" onSubmit={handleSubmit}>
        <div className="ed-modal-header">
          <h2 id="ed-tailor-title">{planOnly ? `Suggest what to hide in “${resume.name}”` : `Tailor “${resume.name}” with AI`}</h2>
        </div>
        <div className="ed-modal-body">
          <div className="ed-form ed-modal-section">
            {planOnly ? (
              <>
                <BriefFields form={form} onChange={setForm} limits={limits} idPrefix="ed-tailor" disabled={busy} />
                <PlanFields form={form} onChange={setForm} idPrefix="ed-tailor" disabled={busy} />
                <span className="ed-field-hint">
                  The AI reads what this resume shows now and suggests what to hide for this audience, each with a reason, for you to
                  review. Nothing is saved until you accept, and hiding never deletes anything.
                </span>
              </>
            ) : (
              <TailorFields form={form} onChange={setForm} limits={limits} idPrefix="ed-tailor" disabled={busy} />
            )}
            {error && <div className="ed-login-error">{error}</div>}
          </div>
          <div className="ed-modal-actions">
            <button type="button" className="ed-btn ed-btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="ed-btn ed-btn-primary" disabled={busy || !form.audience.trim() || !requests}>
              {!requests ? (planOnly ? 'Pick a suggestion' : 'Nothing to tailor') : planOnly ? 'Suggest' : `Tailor (${requests})`}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
