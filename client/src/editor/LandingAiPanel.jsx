import { useEffect, useState } from 'react';
import { DiffText } from './AiRewritePanel.jsx';
import { TARGET_LABELS, presetsFor, targetKey } from './landingAi.js';

// The ✨ panel under one field of the landing page form (issue #73). Asking
// for a rewrite and holding what comes back happen in LandingEditorPage (so
// the preview can show it); this collects the instruction and shows the
// review. `ai` is LandingEditorPage's: `requestFor(key)`, `placedFor(key)`,
// `onRequest(target, instruction)`, `onAccept(id)`, `onReject(id)` and
// `onCancel(key)`. `current` is the field's text now, for the presets.
//
// An `intro` target writes three fields; its suggestions open in their own
// fields' panels, and this one only says how it went.
export function LandingAiPanel({ ai, target, current = '', label = '✨ Rewrite with AI' }) {
  const key = targetKey(target);
  const request = ai.requestFor(key);
  const placed = target.kind === 'intro' ? null : ai.placedFor(key);
  const [open, setOpen] = useState(Boolean(request || placed));
  const [instruction, setInstruction] = useState(request?.instruction || '');

  // An instruction typed, or sent and not answered yet, is only here: the
  // page is told, so a preset keeps its section (applyPreset()'s `typed`).
  const sectionId = target.sectionId;
  const onTyped = ai.onTyped;
  const typed = Boolean(instruction.trim()) || request?.status === 'loading';
  useEffect(() => {
    if (!typed || !sectionId || !onTyped) return undefined;
    onTyped(sectionId, true);
    return () => onTyped(sectionId, false);
  }, [typed, sectionId, onTyped]);

  // A suggestion this panel didn't ask for (an intro's) opens it, so it
  // isn't left unseen behind the closed button.
  const placedId = placed?.proposal.id;
  useEffect(() => {
    if (placedId) setOpen(true);
  }, [placedId]);

  if (!open) {
    return (
      <div className="ed-ai-panel ed-ai-panel-field">
        <button type="button" className="ed-btn ed-btn-ghost ed-btn-sub" onClick={() => setOpen(true)}>
          {label}
        </button>
      </div>
    );
  }

  const loading = request?.status === 'loading';
  const intro = target.kind === 'intro';
  const canRequest = intro || Boolean(instruction.trim());
  const pending = intro ? ai.pendingFrom(key) : 0;

  function send() {
    if (canRequest && !loading) ai.onRequest(target, instruction.trim());
  }

  function close() {
    if (placed) ai.onReject(placed.proposal.id);
    ai.onCancel(key);
    setOpen(false);
  }

  return (
    <div className="ed-ai-panel ed-ai-panel-open ed-ai-panel-field">
      <div className="ed-ai-review-label">{intro ? label.replace(/^✨\s*/, '') : `Rewrite ${TARGET_LABELS[target.kind]} with AI`}</div>
      {intro && (
        <p className="ed-field-hint">
          Writes the headline, subheadline and first text section from your default resume as it's published. Each
          suggestion opens under its own field to accept or discard.
        </p>
      )}
      {!intro && (
        <div className="ed-ai-presets">
          {presetsFor(target.kind, current).map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="ed-btn ed-btn-ghost ed-btn-sub"
              onClick={() => setInstruction(preset.instruction)}
              disabled={loading}
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        className="ed-textarea"
        rows={2}
        value={loading ? request.instruction : instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
        }}
        placeholder={intro ? 'Optional: anything to stress, e.g. Mention I’m open to consulting' : 'What should change?'}
        maxLength={2000}
        disabled={loading}
        aria-label={`Instruction for rewriting ${TARGET_LABELS[target.kind]}`}
      />
      <div className="ed-ai-actions">
        <button type="button" className="ed-btn ed-btn-primary" onClick={send} disabled={loading || !canRequest}>
          {loading ? 'Writing…' : request?.status === 'ready' ? 'Try again' : intro ? 'Draft' : 'Rewrite'}
        </button>
        <button type="button" className="ed-btn ed-btn-ghost" onClick={close} disabled={loading}>
          {placed ? 'Discard' : 'Cancel'}
        </button>
      </div>

      {request?.status === 'error' && <div className="ed-field-error">{request.error}</div>}
      {request?.status === 'ready' && request.count === 0 && !placed && (
        <div className="ed-ai-review">
          {request.explanation && <p className="ed-ai-explanation">{request.explanation}</p>}
          <p className="ed-field-hint">The AI suggested no changes.</p>
        </div>
      )}
      {intro && request?.status === 'ready' && pending > 0 && (
        <div className="ed-ai-review">
          {request.explanation && <p className="ed-ai-explanation">{request.explanation}</p>}
          <p className="ed-field-hint">
            {pending === 1 ? 'One suggestion is' : `${pending} suggestions are`} waiting below and shown in the preview.
          </p>
        </div>
      )}

      {placed && (
        <div className="ed-ai-review">
          {placed.proposal.via !== 'intro' && placed.proposal.explanation && (
            <p className="ed-ai-explanation">{placed.proposal.explanation}</p>
          )}
          <div className="ed-ai-review-section">
            <DiffText before={placed.proposal.before} after={placed.proposal.after} />
          </div>
          {placed.stale && (
            <div className="ed-field-error">
              You've edited {TARGET_LABELS[target.kind]} since this was written, so the preview leaves it out. Accepting
              replaces your edits.
            </div>
          )}
          <div className="ed-ai-actions">
            <button type="button" className="ed-btn ed-btn-primary" onClick={() => ai.onAccept(placed.proposal.id)}>
              Accept
            </button>
            {!placed.stale && (
              <span className="ed-field-hint">Previewed on the right. Accepting saves a draft change; publish to make it live.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
