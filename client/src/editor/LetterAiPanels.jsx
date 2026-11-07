import { useEffect, useRef, useState } from 'react';
import { DiffText } from './AiRewritePanel.jsx';
import { BriefFields, emptyTailorForm, tailorBrief } from './TailorModal.jsx';
import {
  LETTER_PRESETS,
  LETTER_TARGET,
  PARAGRAPH_PRESETS,
  isLetterProposalStale,
  letterBodyEmpty,
  letterChanges,
  letterTargetKey,
} from '../letters/letterAi.js';

// A cover letter's AI writing (issue #71). CoverLettersPage holds the
// requests and proposals (so the preview can show them) and hands each
// letter's form `ai`: { entries (this letter's, by letterTargetKey),
// previewedKeys (the target keys the preview shows), tailoring (the
// resume's brief, or null), briefLimits, onRequest(target, { instruction,
// brief }), onAccept(target) (true once applied), onReject(target) }. These
// panels collect the request and show the review.

const SENDS_NOTE =
  "Sends this resume's content (sections and bullets hidden everywhere are left out), this letter and the brief to the AI. Nothing is saved until you accept.";

// The proposal's review: what it says it did, the diff, a warning when the
// part it's for was edited since, and Accept. `onAccepted` runs once an
// Accept has gone through (not one cancelled at its confirm).
function LetterReview({ letter, entry, ai, target, onAccepted }) {
  const proposal = entry.proposal;
  const fields = letterChanges(proposal);
  const stale = isLetterProposalStale(proposal, letter.data);
  const paragraph = target.kind === 'paragraph';
  return (
    <div className="ed-ai-review">
      {proposal.explanation && <p className="ed-ai-explanation">{proposal.explanation}</p>}
      {fields.length === 0 && <p className="ed-field-hint">The AI suggested no changes.</p>}
      {fields.map((f) => (
        <div key={f.label} className="ed-ai-review-section">
          <div className="ed-ai-review-label">{f.label}</div>
          <DiffText before={f.before} after={f.after} />
        </div>
      ))}
      {stale && (
        <div className="ed-field-error">
          {paragraph
            ? "This paragraph has been edited or moved since this rewrite was written. Accepting puts the rewrite at this position, replacing what's there now."
            : "You've edited the letter since this was written. Accepting replaces the salutation, body and closing with it."}
        </div>
      )}
      <div className="ed-ai-actions">
        <button type="button" className="ed-btn ed-btn-primary" onClick={() => ai.onAccept(target) && onAccepted?.()}>
          Accept
        </button>
        <span className="ed-field-hint">
          {ai.previewedKeys.has(letterTargetKey(target))
            ? 'Previewed on the right.'
            : stale
              ? 'Not shown in the preview, since it has changed.'
              : 'Not shown in the preview while a rewrite of the whole letter is open.'}{' '}
          Accepting saves it to the letter.
        </span>
      </div>
    </div>
  );
}

// Drafting the whole letter (an empty body) or rewriting it: above the
// form's paragraphs. The brief starts as the resume's tailoring brief and
// can be edited or switched off for this request; it's only sent, never
// saved.
export function LetterDraftPanel({ letter, ai }) {
  const entry = ai.entries[letterTargetKey(LETTER_TARGET)] || null;
  const [open, setOpen] = useState(Boolean(entry));
  const [instruction, setInstruction] = useState(entry?.instruction || '');
  const [useBrief, setUseBrief] = useState(entry ? Boolean(entry.brief) : Boolean(ai.tailoring));
  const [brief, setBrief] = useState(() => emptyTailorForm(entry?.brief || ai.tailoring));
  const empty = letterBodyEmpty(letter.data);

  if (!open) {
    return (
      <div className="ed-ai-panel">
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => setOpen(true)}>
          {empty ? '✨ Draft with AI' : '✨ Rewrite letter with AI'}
        </button>
      </div>
    );
  }

  const loading = entry?.status === 'loading';
  const ready = entry?.status === 'ready';
  const briefOk = !useBrief || Boolean(brief.audience.trim());
  const canRequest = !loading && briefOk && (empty || useBrief || Boolean(instruction.trim()));

  function request() {
    if (!canRequest) return;
    ai.onRequest(LETTER_TARGET, { instruction: instruction.trim(), brief: useBrief ? tailorBrief(brief) : null });
  }

  function close() {
    if (entry) ai.onReject(LETTER_TARGET);
    setOpen(false);
  }

  return (
    <div className="ed-ai-panel ed-ai-panel-open">
      <div className="ed-ai-review-label">{empty ? 'Draft this letter with AI' : 'Rewrite this letter with AI'}</div>
      {!empty && (
        <div className="ed-ai-presets">
          {LETTER_PRESETS.map((preset) => (
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
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) request();
        }}
        placeholder={
          empty || useBrief ? 'Optional: anything to stress, e.g. Lead with the on-call work' : 'What should change? e.g. Make it warmer'
        }
        maxLength={2000}
        disabled={loading}
        aria-label="Instruction for the AI"
      />
      <label className="ed-checkbox-field ed-ai-tailor">
        <input type="checkbox" checked={useBrief} onChange={(e) => setUseBrief(e.target.checked)} disabled={loading} />
        Write it for a job or audience
      </label>
      {useBrief && (
        <div className="ed-form">
          <BriefFields form={brief} onChange={setBrief} limits={ai.briefLimits} idPrefix={`ed-letter-brief-${letter.id}`} disabled={loading} />
          {ai.tailoring && <span className="ed-field-hint">Filled in from what this resume was tailored for. Changes here are only used for this letter's request.</span>}
        </div>
      )}
      <p className="ed-field-hint">{SENDS_NOTE}</p>
      <div className="ed-ai-actions">
        <button type="button" className="ed-btn ed-btn-primary" onClick={request} disabled={!canRequest}>
          {loading ? 'Writing…' : ready ? 'Try again' : empty ? 'Draft letter' : 'Rewrite letter'}
        </button>
        <button type="button" className="ed-btn ed-btn-ghost" onClick={close} disabled={loading}>
          {ready ? 'Discard' : 'Cancel'}
        </button>
      </div>
      {entry?.status === 'error' && <div className="ed-field-error">{entry.error}</div>}
      {/* Accepted, the letter is the one to edit now: the panel and its
          brief fields fold away. */}
      {ready && <LetterReview letter={letter} entry={entry} ai={ai} target={LETTER_TARGET} onAccepted={() => setOpen(false)} />}
    </div>
  );
}

// One paragraph's rewrite, below its row (the row's ✨ button opens it;
// see CoverLetterForm). On a tailored resume it's tailored to the resume's
// brief unless unticked.
export function ParagraphAiPanel({ letter, index, ai, onClose }) {
  const target = { kind: 'paragraph', index };
  const entry = ai.entries[letterTargetKey(target)] || null;
  const [instruction, setInstruction] = useState(entry?.instruction || '');
  const [tailored, setTailored] = useState(entry ? Boolean(entry.brief) : true);
  const tailoring = ai.tailoring ? tailored : false;
  // Rows are keyed by index, so a proposal that follows its paragraph to
  // another row brings its own request with it: take its instruction then,
  // so "Try again" resends what produced the diff on screen (as
  // AiRewritePanel does).
  const seenRequest = useRef(entry?.requestId);
  useEffect(() => {
    if (!entry?.requestId || entry.requestId === seenRequest.current) return;
    seenRequest.current = entry.requestId;
    setInstruction(entry.instruction || '');
    if (ai.tailoring) setTailored(Boolean(entry.brief));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per request, read at the time
  }, [entry]);

  const loading = entry?.status === 'loading';
  const ready = entry?.status === 'ready';
  const canRequest = !loading && (Boolean(instruction.trim()) || tailoring);

  function request() {
    if (!canRequest) return;
    ai.onRequest(target, { instruction: instruction.trim(), brief: tailoring ? ai.tailoring : null });
  }

  function close() {
    if (entry) ai.onReject(target);
    onClose();
  }

  return (
    <div className="ed-ai-panel ed-ai-panel-open ed-ai-panel-inline">
      <div className="ed-ai-review-label">Rewrite paragraph {index + 1} with AI</div>
      <div className="ed-ai-presets">
        {PARAGRAPH_PRESETS.map((preset) => (
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
      <textarea
        className="ed-textarea"
        rows={2}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) request();
        }}
        placeholder={tailoring ? 'Optional: anything else to change' : 'What should change? e.g. Lead with the result'}
        maxLength={2000}
        disabled={loading}
        aria-label={`Instruction for rewriting paragraph ${index + 1}`}
      />
      {ai.tailoring && (
        <label className="ed-checkbox-field ed-ai-tailor">
          <input type="checkbox" checked={tailored} onChange={(e) => setTailored(e.target.checked)} disabled={loading} />
          Tailor for “{ai.tailoring.audience}”
        </label>
      )}
      <div className="ed-ai-actions">
        <button type="button" className="ed-btn ed-btn-primary" onClick={request} disabled={!canRequest}>
          {loading ? 'Rewriting…' : ready ? 'Try again' : 'Rewrite'}
        </button>
        <button type="button" className="ed-btn ed-btn-ghost" onClick={close} disabled={loading}>
          {ready ? 'Discard' : 'Cancel'}
        </button>
      </div>
      {entry?.status === 'error' && <div className="ed-field-error">{entry.error}</div>}
      {ready && <LetterReview letter={letter} entry={entry} ai={ai} target={target} />}
    </div>
  );
}
