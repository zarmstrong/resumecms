// What an editor page would lose by being left (issue #105): the work it
// holds only on screen, which no save can keep. Pure, so unsavedWork.test.js
// covers it; useLeaveGuard.js asks with it before every way of leaving.
//
// Each page describes its own as one shape, with counts for the question:
// { suggestions, hides, order, tailoring, forms }. `suggestions` are the AI
// rewrites the preview shows (a stale one, or one already applied, isn't
// counted: there's nothing in it the page would still show), `hides` and
// `order` a tailoring plan's (EditorPage only), `tailoring` a run still
// going, and `forms` the names of dialogs with changes not yet saved. The
// save queue (saveQueue.js's pending()) is the guard's to add: it can be
// flushed, and is before anything here is asked about.
import { previewedProposals } from './aiReview.js';
import { isHideApplied, isHideStale, isOrderStale } from './tailorPlan.js';
import { placeProposals } from './landingAi.js';
import { previewedLetterProposals } from '../letters/letterAi.js';

const NOTHING = Object.freeze({ suggestions: 0, hides: 0, order: false, tailoring: false, forms: [] });

const readyOf = (entries) =>
  Object.values(entries || {})
    .filter((entry) => entry.status === 'ready' && entry.proposal)
    .map((entry) => entry.proposal);

// EditorPage: its block rewrites (`aiProposals`, by proposal key), the
// plan's hides and order, its tailoring run, and its dirty dialogs.
export function editorUnsavedWork({ blocks = [], aiProposals = {}, planHides = {}, planOrder = null, tailorRun = null, forms = [] }) {
  const ready = readyOf(aiProposals);
  let suggestions = 0;
  for (const block of blocks) {
    const mine = ready.filter((p) => p.blockId === block.id);
    if (mine.length) suggestions += previewedProposals(block.type, block.data, mine).length;
  }
  const hides = Object.values(planHides).filter((hide) => !isHideStale(blocks, hide) && !isHideApplied(blocks, hide)).length;
  return {
    ...NOTHING,
    suggestions,
    hides,
    order: Boolean(planOrder) && !isOrderStale(blocks, planOrder),
    tailoring: Boolean(tailorRun && !tailorRun.finished),
    forms,
  };
}

// CoverLettersPage: the rewrites of every letter, not just the one shown.
export function lettersUnsavedWork({ letters = [], aiEntries = {} }) {
  let suggestions = 0;
  for (const letter of letters || []) {
    const mine = readyOf(Object.values(aiEntries).filter((entry) => entry.letterId === letter.id));
    if (mine.length) suggestions += previewedLetterProposals(letter.data, mine).length;
  }
  return { ...NOTHING, suggestions };
}

// LandingEditorPage: its suggestions that are still where they were made
// and unedited since (placeProposals' non-stale ones). An image upload is
// tracked by the save queue, so the guard waits for it.
export function landingUnsavedWork({ landing = null, aiProposals = [] }) {
  if (!landing) return NOTHING;
  return { ...NOTHING, suggestions: placeProposals(landing, aiProposals).filter((p) => !p.stale).length };
}

export function hasUnsavedWork(work) {
  return Boolean(work && (work.suggestions || work.hides || work.order || work.tailoring || work.forms?.length));
}

// Whether leaving needs the guard at all: anything still on the save queue
// (waiting, in flight, or failed: `pending` is its pending()) or held here.
// With neither, leaving goes ahead as if there were no guard.
export function mustGuard(work, pending) {
  const queued = pending ? pending.waiting + pending.inFlight + pending.failed > 0 : false;
  return queued || hasUnsavedWork(work);
}

const counted = (n, one, many) => (n === 1 ? one : `${n} ${many}`);

function listed(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// The question to ask before leaving, or null when there's nothing to ask
// about, e.g. "You have 3 AI suggestions you haven't accepted and a
// tailoring run in progress. Leave and discard them?"
export function leaveQuestion(work) {
  if (!hasUnsavedWork(work)) return null;
  const unaccepted = [
    work.suggestions ? counted(work.suggestions, 'an AI suggestion', 'AI suggestions') : null,
    work.hides ? counted(work.hides, 'a suggested hide', 'suggested hides') : null,
    work.order ? 'a suggested section order' : null,
  ].filter(Boolean);
  const parts = [
    unaccepted.length ? `${listed(unaccepted)} you haven't accepted` : null,
    work.tailoring ? 'a tailoring run in progress' : null,
    work.forms?.length ? `unsaved changes in ${listed(work.forms)}` : null,
  ].filter(Boolean);
  const things = (work.suggestions || 0) + (work.hides || 0) + (work.order ? 1 : 0) + (work.tailoring ? 1 : 0) + (work.forms?.length || 0);
  return `You have ${listed(parts)}. Leave and discard ${things === 1 ? 'it' : 'them'}?`;
}
