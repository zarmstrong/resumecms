import { useState } from 'react';
import { DEFAULT_TAILOR_TYPES, TAILOR_TYPES, tailorItems } from './tailorRun.js';

// The brief behind AI tailoring (issue #53; the server checks it in
// ai/brief.js) plus which block types to tailor. The fields are shared by
// "Tailor…" (TailorModal, below) and the New resume dialog's "Tailor the
// copy" section. `limits` is the AI settings' briefLimits.

export function emptyTailorForm(tailoring) {
  return {
    audience: tailoring?.audience || '',
    posting: tailoring?.posting || '',
    guidance: tailoring?.guidance || '',
    types: DEFAULT_TAILOR_TYPES,
  };
}

export function tailorBrief(form) {
  return { audience: form.audience.trim(), posting: form.posting.trim(), guidance: form.guidance.trim() };
}

// How many requests the form's choices make for `blocks` (null: unknown).
export function tailorCount(form, blocks) {
  return blocks ? tailorItems(blocks, form.types).length : null;
}

export function TailorFields({ form, onChange, limits, idPrefix, disabled = false }) {
  const set = (key) => (e) => onChange({ ...form, [key]: e.target.value });
  const toggle = (type) => (e) =>
    onChange({ ...form, types: e.target.checked ? [...form.types, type] : form.types.filter((t) => t !== type) });
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
      <fieldset className="ed-field ed-tailor-types" disabled={disabled}>
        <legend>Sections to tailor</legend>
        {TAILOR_TYPES.map(({ type, label }) => (
          <label key={type} className="ed-checkbox-field">
            <input type="checkbox" checked={form.types.includes(type)} onChange={toggle(type)} />
            {label}
          </label>
        ))}
      </fieldset>
      <span className="ed-field-hint">
        Each section gets its own AI rewrite to review; nothing is saved until you accept it. Tailoring changes what's stressed
        and how it's worded, never the facts.
      </span>
    </>
  );
}

// "Tailor…" for the open resume, pre-filled with the brief it was last
// tailored for. `onTailor(brief, types)` saves the brief and starts the
// run (EditorPage's); this closes once it has.
export function TailorModal({ resume, blocks, limits, onTailor, onClose }) {
  const [form, setForm] = useState(() => emptyTailorForm(resume.tailoring));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const count = tailorCount(form, blocks);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onTailor(tailorBrief(form), form.types);
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
          <h2 id="ed-tailor-title">Tailor “{resume.name}” with AI</h2>
        </div>
        <div className="ed-modal-body">
          <div className="ed-form ed-modal-section">
            <TailorFields form={form} onChange={setForm} limits={limits} idPrefix="ed-tailor" disabled={busy} />
            {error && <div className="ed-login-error">{error}</div>}
          </div>
          <div className="ed-modal-actions">
            <button type="button" className="ed-btn ed-btn-ghost" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="ed-btn ed-btn-primary" disabled={busy || !form.audience.trim() || count === 0}>
              {count === 0 ? 'Nothing to tailor' : `Tailor (${count} rewrite${count === 1 ? '' : 's'})`}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
