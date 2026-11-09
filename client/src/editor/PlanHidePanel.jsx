import { describeTarget } from './aiReview.js';
import { surfacesLabel } from './tailorPlan.js';

// A tailoring plan's suggestions in the editor (issue #84, tailorPlan.js).

const preview = (text) => {
  const t = (text || '').trim();
  return t.length > 50 ? `${t.slice(0, 50)}…` : t;
};

function hideLabel(hide) {
  const from = surfacesLabel(hide.surfaces);
  if (hide.path) {
    const what = describeTarget({ kind: 'bullet', path: hide.path });
    return `AI suggests hiding ${what}${hide.before.text ? ` (“${preview(hide.before.text)}”)` : ''} from ${from}`;
  }
  return `AI suggests hiding this ${hide.section ? 'section' : 'block'} from ${from}`;
}

// The hides suggested for one block (its own, its section's, or its
// bullets'), under its row's header so they show without opening the row.
// `plan` is EditorPage's { hides, shown, onAccept, onReject }: `shown`
// holds the keys the preview shows, so the others get a note saying why
// not.
export function PlanHideList({ blockId, plan }) {
  const hides = Object.values(plan?.hides || {})
    .filter((h) => h.blockId === blockId)
    .sort((a, b) => (a.path ? 1 : 0) - (b.path ? 1 : 0) || String(a.path).localeCompare(String(b.path), undefined, { numeric: true }));
  if (!hides.length) return null;
  return (
    <div className="ed-plan-hides">
      {hides.map((hide) => (
        <div key={hide.key} className="ed-plan-hide" role="group" aria-label={hideLabel(hide)}>
          <div className="ed-plan-hide-text">
            <strong>✨ {hideLabel(hide)}</strong>
            {hide.reason && <span>: {hide.reason}</span>}
            {!plan.shown.has(hide.key) && (
              <span className="ed-plan-hide-note">
                {' '}
                Not in the preview: it was changed since, or a rewrite that can move bullets is open.
              </span>
            )}
          </div>
          <div className="ed-plan-hide-actions">
            <button type="button" className="ed-btn ed-btn-ghost" onClick={() => plan.onReject(hide.key)}>
              Discard
            </button>
            <button type="button" className="ed-btn ed-btn-primary" onClick={() => plan.onAccept(hide.key)}>
              Hide
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// The suggested section order, above the preview, which shows it while
// it's open. A stale one (the blocks or their nesting changed since) can
// only be discarded: it has to be asked for again.
export function PlanOrderBanner({ order, stale, onAccept, onReject }) {
  return (
    <div className="ed-preview-label ed-ai-preview-banner" role="status">
      <span>
        {stale
          ? 'AI suggested a section order, but the sections have changed since, so it can’t be applied. Ask for a new one.'
          : `AI suggests a section order, shown in the preview — not saved yet.${order.reason ? ` ${order.reason}` : ''}`}
      </span>
      <button type="button" className="ed-btn ed-btn-ghost" onClick={onReject}>
        Discard
      </button>
      {!stale && (
        <button type="button" className="ed-btn ed-btn-primary" onClick={onAccept}>
          Accept order
        </button>
      )}
    </div>
  );
}
