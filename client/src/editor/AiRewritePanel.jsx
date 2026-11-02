import { useState } from 'react';
import { bulletChange, changedFields, hiddenBulletCount, isProposalStale, presetsFor, wordDiff } from './aiReview.js';

function DiffText({ before, after }) {
  return (
    <span className="ed-diff">
      {wordDiff(before, after).map((run, i) =>
        run.type === 'same' ? (
          <span key={i}>{run.text}</span>
        ) : run.type === 'add' ? (
          <ins key={i} className="ed-diff-add">{run.text}</ins>
        ) : (
          <del key={i} className="ed-diff-del">{run.text}</del>
        )
      )}
    </span>
  );
}

function visibilityNote({ visibleWeb, visiblePrint }) {
  if (!visibleWeb && !visiblePrint) return 'hidden';
  if (!visibleWeb) return 'hidden on web';
  if (!visiblePrint) return 'hidden in print';
  return null;
}

function BulletReview({ review }) {
  if (!review || (review.items.length === 0 && review.removed.length === 0)) return null;
  return (
    <div className="ed-ai-review-section">
      <div className="ed-ai-review-label">Bullets</div>
      <ul className="ed-ai-bullets">
        {review.items.map((item, i) => {
          const change = bulletChange(item);
          const note = visibilityNote(item);
          return (
            <li key={i} className={`ed-ai-bullet${item.depth ? ' ed-ai-bullet-sub' : ''}`}>
              <span className={`ed-ai-badge ed-ai-badge-${change}`}>{change}</span>
              {note && <span className="ed-ai-badge ed-ai-badge-hidden">{note}</span>}
              {change === 'added' ? <ins className="ed-diff-add">{item.after}</ins> : <DiffText before={item.before} after={item.after} />}
            </li>
          );
        })}
        {review.removed.map((item, i) => (
          <li key={`removed-${i}`} className={`ed-ai-bullet${item.depth ? ' ed-ai-bullet-sub' : ''}`}>
            <span className="ed-ai-badge ed-ai-badge-removed">removed</span>
            {item.wasHidden && <span className="ed-ai-badge ed-ai-badge-hidden">was hidden</span>}
            <del className="ed-diff-del">{item.before}</del>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Lives in an expanded block row. Requesting a rewrite and holding the
// proposal happen in EditorPage (so the right-hand preview can show it);
// this panel only collects the instruction and shows the review.
export function AiRewritePanel({ block, ai }) {
  const state = ai.state?.blockId === block.id ? ai.state : null;
  const [open, setOpen] = useState(Boolean(state));
  const [instruction, setInstruction] = useState(state?.instruction || '');

  if (!open) {
    return (
      <div className="ed-ai-panel">
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => setOpen(true)}>
          ✨ Rewrite with AI
        </button>
      </div>
    );
  }

  const loading = state?.status === 'loading';
  const proposal = state?.status === 'ready' ? state.proposal : null;
  const fields = proposal ? changedFields(block.type, proposal.baseData, proposal.proposedData) : [];
  const stale = proposal && isProposalStale(proposal, block.data);
  const hiddenCount = hiddenBulletCount(block.type, block.data);
  const unchanged = proposal && fields.length === 0 && !proposal.bulletReview?.items.some((i) => bulletChange(i) !== 'unchanged') && !proposal.bulletReview?.removed.length;

  function request() {
    if (instruction.trim()) ai.onRequest(block.id, instruction.trim());
  }

  function close() {
    if (state) ai.onReject();
    setOpen(false);
  }

  return (
    <div className="ed-ai-panel ed-ai-panel-open">
      <div className="ed-ai-presets">
        {presetsFor(block.type, block.data).map((preset) => (
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
        placeholder="What should change? e.g. Tailor this toward platform engineering roles"
        maxLength={2000}
        disabled={loading}
      />
      {hiddenCount > 0 && (
        <p className="ed-field-hint">
          {hiddenCount === 1 ? 'One bullet here is' : `${hiddenCount} bullets here are`} hidden from web or print. Hidden
          bullets are sent to the AI too. It's told to keep them out of the tagline and description, which always
          show, but check the review before accepting.
        </p>
      )}
      <div className="ed-ai-actions">
        <button type="button" className="ed-btn ed-btn-primary" onClick={request} disabled={loading || !instruction.trim()}>
          {loading ? 'Rewriting…' : proposal ? 'Try again' : 'Rewrite'}
        </button>
        <button type="button" className="ed-btn ed-btn-ghost" onClick={close} disabled={loading}>
          {proposal ? 'Discard' : 'Cancel'}
        </button>
      </div>

      {state?.status === 'error' && <div className="ed-field-error">{state.error}</div>}

      {proposal && (
        <div className="ed-ai-review">
          {proposal.explanation && <p className="ed-ai-explanation">{proposal.explanation}</p>}
          {unchanged && <p className="ed-field-hint">The AI suggested no changes.</p>}
          {fields.map((f) => (
            <div key={f.label} className="ed-ai-review-section">
              <div className="ed-ai-review-label">{f.label}</div>
              <DiffText before={f.before} after={f.after} />
            </div>
          ))}
          <BulletReview review={proposal.bulletReview} />
          {stale && (
            <div className="ed-field-error">
              You've edited this block since this rewrite was generated. Accepting replaces those edits.
            </div>
          )}
          <div className="ed-ai-actions">
            <button type="button" className="ed-btn ed-btn-primary" onClick={() => ai.onAccept()}>
              Accept
            </button>
            <span className="ed-field-hint">Previewed on the right. Accepting saves a draft change; publish to make it live.</span>
          </div>
        </div>
      )}
    </div>
  );
}
