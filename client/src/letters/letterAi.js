// Pure helpers behind a cover letter's AI writing (issue #71): the server's
// ai/letterWriting.js returns a proposal for the whole letter (`letter`:
// its salutation, body and closing) or one paragraph (`paragraph`, by
// index), and CoverLettersPage holds it for review, the way EditorPage
// holds block rewrites (editor/aiReview.js).
import { lcsPairs } from '../editor/aiReview.js';

export const LETTER_TARGET = Object.freeze({ kind: 'letter' });

// Mirrors letterTargetKey in server/src/ai/letterWriting.js.
export function letterTargetKey(target) {
  return target?.kind === 'paragraph' ? `paragraph:${target.index}` : 'letter';
}

export function letterProposalKey(letterId, target) {
  return `${letterId}:${letterTargetKey(target)}`;
}

const paragraphsOf = (data) => (Array.isArray(data?.paragraphs) ? data.paragraphs : []);

// The body has nothing in it yet, so a whole-letter request is a draft.
export function letterBodyEmpty(data) {
  return paragraphsOf(data).every((p) => typeof p !== 'string' || !p.trim());
}

// The part of `data` a target owns; null for a paragraph that isn't there.
export function letterSlice(data, target = LETTER_TARGET) {
  if (target?.kind === 'paragraph') return paragraphsOf(data)[target.index] ?? null;
  return { salutation: data?.salutation ?? '', paragraphs: paragraphsOf(data), closing: data?.closing ?? '' };
}

// Where the proposal's text sits in its own baseData and proposedData; it
// differs from `target` once a moved paragraph has been followed.
const originOf = (proposal) => proposal.origin || proposal.target;

const sliceJson = (data, target) => JSON.stringify(letterSlice(data, target));

// The part the proposal is for changed after it was made, so accepting
// would overwrite those edits.
export function isLetterProposalStale(proposal, currentData) {
  return sliceJson(proposal.baseData, originOf(proposal)) !== sliceJson(currentData, proposal.target);
}

// `currentData` with the proposal's target replaced by what it proposes,
// and nothing else touched. A paragraph that's no longer there leaves the
// data as it is.
export function applyLetterProposal(currentData, proposal) {
  currentData = currentData || {};
  const { target, proposedData } = proposal;
  if (target?.kind === 'paragraph') {
    const replacement = paragraphsOf(proposedData)[originOf(proposal).index];
    const paragraphs = paragraphsOf(currentData);
    if (typeof replacement !== 'string' || target.index >= paragraphs.length) return currentData;
    return { ...currentData, paragraphs: paragraphs.map((p, i) => (i === target.index ? replacement : p)) };
  }
  return { ...currentData, salutation: proposedData.salutation, paragraphs: proposedData.paragraphs, closing: proposedData.closing };
}

// The proposals the preview lays over the letter, in order. A whole-letter
// one always shows. A paragraph one shows while its paragraph is as it
// was, and not under a whole-letter one, which replaces the body it
// points into.
export function previewedLetterProposals(data, proposals) {
  const whole = proposals.filter((p) => p.target?.kind !== 'paragraph');
  if (whole.length) return whole;
  return proposals.filter((p) => !isLetterProposalStale(p, data));
}

export function previewLetterData(data, proposals) {
  return previewedLetterProposals(data, proposals).reduce((current, p) => applyLetterProposal(current, p), data);
}

// A paragraph proposal is tied to a position, and positions shift when
// paragraphs are dragged, removed or added. Returns where it applies now,
// by aligning `proposal.anchorData`'s paragraphs (the data it was last
// placed against; baseData until then) with the current ones, with the
// same rules as editor/aiReview.js's relocateTarget, which CoverLettersPage
// also calls on every change so each call resolves one edit: an unchanged
// paragraph is followed; one edited in place stays put (stale); otherwise
// the one unpaired exact copy is where it was dragged; otherwise null when
// its position is gone, else it stays. Returns `proposal.target` itself
// when nothing moved. A whole-letter target never moves.
export function relocateParagraph(proposal, currentData) {
  const { target } = proposal;
  if (target?.kind !== 'paragraph') return target;
  const a = paragraphsOf(proposal.anchorData ?? proposal.baseData);
  const b = paragraphsOf(currentData);
  const o = target.index;
  const stay = o < b.length ? target : null;
  if (o >= a.length) return stay;
  const at = (index) => (index === o ? target : { kind: 'paragraph', index });
  const pairs = lcsPairs(a, b);

  const paired = pairs.find(([i]) => i === o);
  if (paired) return at(paired[1]);

  let before = [-1, -1];
  let after = [a.length, b.length];
  for (const pair of pairs) {
    if (pair[0] < o) before = pair;
    else {
      after = pair;
      break;
    }
  }
  if (after[0] - before[0] === after[1] - before[1]) return at(before[1] + (o - before[0]));

  const pairedCurrent = new Set(pairs.map(([, j]) => j));
  const moved = b.map((_, j) => j).filter((j) => !pairedCurrent.has(j) && b[j] === a[o]);
  if (moved.length === 1) return at(moved[0]);
  return stay;
}

// What the review shows as changed, as { label, before, after }: only the
// fields that differ. The body is compared as one text, a blank line
// between paragraphs.
export function letterChanges(proposal) {
  const { baseData, proposedData } = proposal;
  const origin = originOf(proposal);
  const fields = [];
  const add = (label, before, after) => {
    if ((before || '') !== (after || '')) fields.push({ label, before: before || '', after: after || '' });
  };
  if (origin?.kind === 'paragraph') {
    add(`Paragraph ${proposal.target.index + 1}`, paragraphsOf(baseData)[origin.index], paragraphsOf(proposedData)[origin.index]);
    return fields;
  }
  const body = (data) => paragraphsOf(data).filter((p) => p.trim()).join('\n\n');
  add('Salutation', baseData.salutation, proposedData.salutation);
  add('Letter', body(baseData), body(proposedData));
  add('Closing', baseData.closing, proposedData.closing);
  return fields;
}

export const LETTER_PRESETS = [
  { label: 'Shorter', instruction: 'Make the letter shorter and tighter without losing what matters.' },
  { label: 'More formal', instruction: 'Make the tone more formal.' },
  { label: 'Warmer', instruction: 'Make the tone warmer and more personal, without overdoing it.' },
  { label: 'Fix grammar', instruction: 'Fix grammar, spelling, and punctuation only. Change nothing else.' },
];

export const PARAGRAPH_PRESETS = [
  { label: 'Tighten', instruction: 'Make this paragraph more concise without losing any substance.' },
  { label: 'More specific', instruction: 'Make this paragraph more specific, drawing on concrete details from my resume.' },
  { label: 'Fix grammar', instruction: 'Fix grammar, spelling, and punctuation only. Change nothing else.' },
];
