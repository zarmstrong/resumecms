import { useEffect, useRef, useState } from 'react';
import {
  BLOCK_TARGET,
  bulletChange,
  changedFields,
  contextNote,
  describeTarget,
  hiddenBulletCount,
  isProposalStale,
  pickerTense,
  presetsFor,
  previewedProposals,
  proposalKey,
  tenseChangeNote,
  wordDiff,
} from './aiReview.js';

export function DiffText({ before, after }) {
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

// Where hidden bullets end up for each target, for the panel's note about
// them (they're sent to the AI either way).
function hiddenNote(target, count) {
  const subject = count === 1 ? 'One bullet here is' : `${count} bullets here are`;
  switch (target.kind) {
    case 'description':
      return `${subject} hidden from web or print. Hidden bullets are sent to the AI as context. It's told to keep them out of the description, which always shows, but check the review before accepting.`;
    case 'bullet':
      return `${subject} hidden from web or print. Hidden bullets are sent to the AI as context. It's told not to carry their content into this bullet unless it's hidden too, but check the review before accepting.`;
    default:
      return `${subject} hidden from web or print. Hidden bullets are sent to the AI too. It's told to keep them out of the tagline, which always shows, but check the review before accepting.`;
  }
}

const PLACEHOLDERS = {
  block: 'What should change? e.g. Tailor this toward platform engineering roles',
  description: 'What should change? e.g. Focus on the platform work',
  bullet: 'What should change? e.g. Lead with the result',
  item: 'What should change? e.g. Make this more specific',
};

// Requesting a rewrite and holding the proposal happen in EditorPage (so
// the right-hand preview can show it); this panel only collects the
// instruction and shows the review. `target` (see aiReview.js) picks the
// part of the block it rewrites.
//
// Uncontrolled (no `open` prop), it renders its own `label` button and
// opens in place: the block-level panel and the description's. Controlled,
// the caller owns the trigger and `open`, and `onClose` runs when the panel
// is closed: a bullet or item row puts its button in the row and the panel
// below it.
export function AiRewritePanel({ block, ai, target = BLOCK_TARGET, open: openProp, onClose, label = '✨ Rewrite with AI', className = '' }) {
  const key = proposalKey(block.id, target);
  const state = ai.proposals?.[key] || null;
  const controlled = openProp !== undefined;
  const [openState, setOpenState] = useState(Boolean(state));
  const [instruction, setInstruction] = useState(state?.instruction || '');
  // Custom blocks pick a tense per rewrite (pickerTense). Without the options
  // from the server there's no picker, and no tense is sent, so the server
  // applies its default.
  const picksTense = Boolean(ai.pickedTenseTypes?.includes(block.type) && Object.keys(ai.pickedTenses ?? {}).length);
  // A pick is local to this panel and lasts as long as it stays mounted and
  // open, through Accept or a Discard from the preview banner, so later
  // rewrites keep it. This panel's own Cancel and Discard buttons close it and
  // clear the pick. Collapsing the block row unmounts the panel; on remount the
  // pick comes back only if it was sent with AI state still held for this
  // block and target (loading, error, or a proposal), and is otherwise
  // dropped. A picker left on the default keeps following the setting.
  const [pickedTense, setPickedTense] = useState(state?.pickedTense ?? null);
  const tense = pickerTense(pickedTense, ai.pickedTenseDefault, ai.pickedTenses);
  // On a tailored resume (ai.tailoring, issue #53), a rewrite is tailored to
  // its brief unless unticked; with it ticked the instruction is optional.
  // A request already made keeps its own choice.
  const [tailored, setTailored] = useState(state ? Boolean(state.tailored) : true);
  const tailoring = ai.tailoring ? tailored : false;
  const open = controlled ? openProp : openState;
  // Bullet and item rows are keyed by index, so when proposals follow their
  // bullets to new positions (EditorPage's relocation), a mounted panel can
  // start showing a different request than the one it was seeded from.
  // Take that request's instruction and tense then, so "Try again" resends
  // what produced the diff on screen. A request made from this panel already
  // carries this panel's values, so syncing to it changes nothing.
  // A request this panel didn't make (a tailoring run's) opens it too, so
  // its result isn't left unseen behind the closed button; a controlled
  // row panel does the same through its caller (useRowPanelOpen).
  const seenRequest = useRef(state?.requestId);
  useEffect(() => {
    if (!state?.requestId || state.requestId === seenRequest.current) return;
    seenRequest.current = state.requestId;
    // A tailoring run's request has no instruction of its own: leave one
    // typed here but not sent yet.
    if (state.instruction || !state.tailored) setInstruction(state.instruction || '');
    setPickedTense(state.pickedTense ?? null);
    // Only a request made while the resume had a brief says anything about
    // the checkbox; one from before keeps it at its default.
    if (ai.tailoring) setTailored(Boolean(state.tailored));
    if (!controlled) setOpenState(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- per request, read at the time
  }, [state, controlled]);

  if (!open) {
    if (controlled) return null;
    return (
      <div className={`ed-ai-panel ${className}`}>
        <button type="button" className="ed-btn ed-btn-ghost" onClick={() => setOpenState(true)}>
          {label}
        </button>
      </div>
    );
  }

  const loading = state?.status === 'loading';
  const proposal = state?.status === 'ready' ? state.proposal : null;
  // The diff reads the proposal's own data, so it uses the position the
  // proposal was made at, not where the item has since moved to.
  const fields = proposal
    ? changedFields(block.type, proposal.baseData, proposal.proposedData, proposal.origin || proposal.target)
    : [];
  const stale = proposal && isProposalStale(block.type, proposal, block.data);
  const hiddenCount = target.kind === 'item' ? 0 : hiddenBulletCount(block.type, block.data);
  const tenseNote = picksTense && proposal ? tenseChangeNote(state.tense, tense, ai.pickedTenses) : null;
  const unchanged = proposal && fields.length === 0 && !proposal.bulletReview?.items.some((i) => bulletChange(i) !== 'unchanged') && !proposal.bulletReview?.removed.length;
  const part = describeTarget(target);
  // Whether the right-hand preview is showing this proposal (see
  // previewedProposals); if not, the panel says so instead of leaving the
  // user to wonder why the preview didn't change.
  const blockReady = Object.values(ai.proposals || {})
    .filter((e) => e.blockId === block.id && e.status === 'ready')
    .map((e) => e.proposal);
  const inPreview = proposal && previewedProposals(block.type, block.data, blockReady).includes(proposal);

  const canRequest = Boolean(instruction.trim()) || tailoring;
  function request() {
    if (!canRequest) return;
    ai.onRequest(block.id, target, instruction.trim(), picksTense ? tense : undefined, picksTense ? pickedTense : null, {
      tailored: tailoring,
    });
  }

  function close() {
    if (state) ai.onReject(key);
    setPickedTense(null);
    if (controlled) onClose?.();
    else setOpenState(false);
  }

  return (
    <div className={`ed-ai-panel ed-ai-panel-open ${className}`}>
      {part && <div className="ed-ai-review-label">Rewrite {part} with AI</div>}
      <div className="ed-ai-presets">
        {presetsFor(block.type, block.data, target).map((preset) => (
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
        placeholder={tailoring ? 'Optional: anything else to change' : PLACEHOLDERS[target.kind] || PLACEHOLDERS.block}
        maxLength={2000}
        disabled={loading}
        aria-label={part ? `Instruction for rewriting ${part}` : 'Instruction for the AI rewrite'}
      />
      {hiddenCount > 0 && <p className="ed-field-hint">{hiddenNote(target, hiddenCount)}</p>}
      {ai.tailoring && (
        <label className="ed-checkbox-field ed-ai-tailor">
          <input type="checkbox" checked={tailored} onChange={(e) => setTailored(e.target.checked)} disabled={loading} />
          Tailor for “{ai.tailoring.audience}”
        </label>
      )}
      {contextNote(block.type) && <p className="ed-field-hint">{contextNote(block.type)}</p>}
      <div className="ed-ai-actions">
        {picksTense && (
          <select
            className="ed-input ed-ai-tense"
            aria-label="Tense for this rewrite"
            title="Tense for this rewrite. A tense named in the instruction wins."
            value={tense}
            onChange={(e) => setPickedTense(e.target.value)}
            disabled={loading}
          >
            {Object.entries(ai.pickedTenses).map(([id, { label }]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        )}
        <button type="button" className="ed-btn ed-btn-primary" onClick={request} disabled={loading || !canRequest}>
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
          {tenseNote && <p className="ed-field-hint">{tenseNote}</p>}
          {fields.map((f) => (
            <div key={f.label} className="ed-ai-review-section">
              <div className="ed-ai-review-label">{f.label}</div>
              <DiffText before={f.before} after={f.after} />
            </div>
          ))}
          <BulletReview review={proposal.bulletReview} />
          {stale && (
            <div className="ed-field-error">
              {target.kind === 'bullet'
                ? "This bullet has been edited or moved since this rewrite was generated. Accepting puts the rewrite at this position, replacing what's there now."
                : `You've edited this ${part || 'block'} since this rewrite was generated. Accepting replaces those edits.`}
            </div>
          )}
          <div className="ed-ai-actions">
            <button type="button" className="ed-btn ed-btn-primary" onClick={() => ai.onAccept(key)}>
              Accept
            </button>
            <span className="ed-field-hint">
              {inPreview
                ? 'Previewed on the right. Accepting saves a draft change; publish to make it live.'
                : stale
                  ? 'Not shown in the preview, since it has changed. Accepting saves a draft change; publish to make it live.'
                  : 'Not shown in the preview while a rewrite that can add, remove, or reorder these bullets is open. Accepting applies it to the bullet here and saves a draft change.'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
