// @ts-check
// Pure helpers behind the AI rewrite review panel (AiRewritePanel.jsx).
import { normalizeBullet } from '../resume/bulletUtils.js';
import { bulletAt, updateAtPath } from './bulletDrag.js';

// Mirrors REWRITABLE_TYPES in server/src/ai/rewritableFields.js.
export const AI_REWRITABLE_TYPES = new Set(['heading', 'summary', 'executive_summary', 'skills_group', 'experience', 'custom']);

// What part of a block a rewrite is aimed at; see the server's
// rewritableFields.js. `block` is the whole block (for an experience block,
// everything but the description), `description` an experience block's
// description, `bullet` one experience bullet by index path ([i] with its
// sub-bullets, or [i, j]), `item` one custom-section item.
/**
 * A rewrite's target (RewriteTarget in the server's rewritableFields.js),
 * or a tailoring plan's `hide` (tailorPlan.js), which shares its keys.
 * @typedef {{ kind: 'block' }
 *   | { kind: 'description' }
 *   | { kind: 'bullet', path: number[] }
 *   | { kind: 'item', index: number }
 *   | { kind: 'hide', path?: number[] }} AiTarget
 */
/**
 * A proposal as POST …/ai/rewrite answers it (`{ blockId, baseData,
 * ...rewriteBlock() }` in the server's routes/ai.js), plus what EditorPage
 * adds as it follows a moved bullet or item: `origin`, where the text sits
 * in baseData and proposedData, and `anchorData`, the data `target` was
 * last placed against (see relocateTarget); and, on a custom block's,
 * `itemsChanged` once its item count has differed (see itemCountChanged).
 * @typedef {{
 *   blockId: string,
 *   target: AiTarget,
 *   origin?: AiTarget,
 *   baseData: Record<string, any>,
 *   anchorData?: Record<string, any>,
 *   proposedData: Record<string, any>,
 *   itemsChanged?: boolean,
 *   bulletReview?: { items: object[], removed: object[] } | null,
 *   explanation?: string,
 *   allowBulletRestructure?: boolean,
 * }} AiProposal
 */
/** @type {Readonly<AiTarget>} */
export const BLOCK_TARGET = Object.freeze({ kind: 'block' });

// Mirrors targetKey in server/src/ai/rewritableFields.js.
/**
 * @param {AiTarget | null | undefined} target
 * @returns {string}
 */
export function targetKey(target) {
  switch (target?.kind) {
    case 'description':
      return 'description';
    case 'bullet':
      return `bullet:${target.path.join('.')}`;
    case 'item':
      return `item:${target.index}`;
    // A tailoring plan's hide (editor/tailorPlan.js), not a rewrite: a
    // block or section, or one bullet. Mirrors the server's hideKey.
    case 'hide':
      return target.path ? `hide:${target.path.join('.')}` : 'hide';
    default:
      return 'block';
  }
}

// Proposals are held per block and target, so several can be open at once,
// including several on one block.
/**
 * @param {string} blockId
 * @param {AiTarget | null | undefined} target
 */
export function proposalKey(blockId, target) {
  return `${blockId}:${targetKey(target)}`;
}

// For labels: "bullet 2", "sub-bullet 2.1", "item 3", or null for the block.
/**
 * @param {AiTarget | null | undefined} target
 * @returns {string | null}
 */
export function describeTarget(target) {
  switch (target?.kind) {
    case 'description':
      return 'description';
    case 'bullet':
      return target.path.length === 1 ? `bullet ${target.path[0] + 1}` : `sub-bullet ${target.path[0] + 1}.${target.path[1] + 1}`;
    case 'item':
      return `item ${target.index + 1}`;
    default:
      return null;
  }
}

const normalizedBullets = (data) => (Array.isArray(data?.bullets) ? data.bullets.map((b) => normalizeBullet(b)) : []);

// The whole block minus what a block target doesn't own: an experience
// block's description has its own target, and the server copies it through
// a block rewrite unchanged.
function withoutDescription(type, data) {
  if (type !== 'experience' || !data || !('description' in data)) return data;
  const { description, ...rest } = data;
  return rest;
}

// A custom item's date (issue #214) is never rewritten: the server reads
// it as context only and copies it through. So no target owns it, and a
// date edited while a proposal is open doesn't make it stale, nor is it
// undone by accepting the proposal (applyProposal keeps the current dates
// wherever it can still tell which item is which).
/** @param {any} item a stored item, or null for one that isn't there */
function withoutDate(item) {
  if (!item || typeof item !== 'object' || !('date' in item)) return item;
  const { date, ...rest } = item;
  return rest;
}

/**
 * @param {any} item
 * @param {any} current the item whose date to keep
 */
function withDateOf(item, current) {
  const rest = withoutDate(item);
  return current && typeof current === 'object' && 'date' in current ? { ...rest, date: current.date } : rest;
}

function withoutItemDates(type, data) {
  if (type !== 'custom' || !Array.isArray(data?.items)) return data;
  return { ...data, items: data.items.map(withoutDate) };
}

// The part of `data` a target owns: for a block target, the whole data
// (less an experience description, and a custom block's item dates).
/**
 * @param {string} type
 * @param {Record<string, any> | null | undefined} data
 * @param {AiTarget | null} [target]
 */
export function targetSlice(type, data, target = BLOCK_TARGET) {
  data = data || {};
  switch (target?.kind) {
    case 'description':
      return data.description || '';
    case 'bullet':
      return bulletAt(normalizedBullets(data), target.path);
    case 'item':
      return withoutDate((Array.isArray(data.items) ? data.items[target.index] : null) ?? null);
    default:
      return withoutItemDates(type, withoutDescription(type, data));
  }
}

// Where a proposal's text sits in its own baseData and proposedData. It
// differs from `target` (where it applies now) once the editor has followed
// a moved bullet or item to its new position; see relocateTarget.
/** @type {(proposal: AiProposal) => AiTarget} */
const originOf = (proposal) => proposal.origin || proposal.target;

// Every position of one kind in `data`, for relocateTarget.
/**
 * @param {Record<string, any> | null | undefined} data
 * @param {'bullet' | 'item'} kind
 * @returns {AiTarget[]}
 */
function positionsOf(data, kind) {
  if (kind === 'bullet') {
    return normalizedBullets(data).flatMap((b, i) => [
      { kind: 'bullet', path: [i] },
      ...b.children.map((_, j) => ({ kind: 'bullet', path: [i, j] })),
    ]);
  }
  return (Array.isArray(data?.items) ? data.items : []).map((_, index) => ({ kind: 'item', index }));
}

// A custom item as it's compared (isProposalStale, relocateTarget), never
// saved: as the editor's form writes it back. CustomForm normalizes every
// legacy { heading, body } item of a block (adding bodyType and text) on
// any edit to it, so without this an edit elsewhere in the block, a date's
// included, would make the block's proposals stale. Keys are sorted, so
// the order an edit leaves them in doesn't count either.
/** @param {any} item */
function comparableItem(item) {
  if (!item || typeof item !== 'object') return item;
  const normalized = item.bodyType ? item : { ...item, bodyType: 'text', text: item.body };
  return Object.fromEntries(Object.keys(normalized).sort().map((key) => [key, normalized[key]]));
}

/**
 * @param {string} type
 * @param {any} slice targetSlice() of `target`
 * @param {AiTarget | null | undefined} target
 */
function comparableSlice(type, slice, target) {
  if (type !== 'custom') return slice;
  if (target?.kind === 'item') return comparableItem(slice);
  if (targetKey(target) === 'block' && Array.isArray(slice?.items)) return { ...slice, items: slice.items.map(comparableItem) };
  return slice;
}

const sliceJson = (type, data, target) => JSON.stringify(comparableSlice(type, targetSlice(type, data, target), target) ?? null);

// What relocateTarget tells positions apart by: a custom item's date
// included, since the lists the date is for repeat themselves (the same
// award or talk in several years, differing only by it). Only staleness
// leaves the date out. A date edited alone is then an unpaired item in a
// gap of the same size on both sides, which rule 2 keeps in place.
/**
 * @param {string} type
 * @param {Record<string, any> | null | undefined} data
 * @param {AiTarget} target
 */
function placeJson(type, data, target) {
  if (type !== 'custom' || target.kind !== 'item') return sliceJson(type, data, target);
  const item = Array.isArray(data?.items) ? data.items[target.index] : null;
  return JSON.stringify(comparableItem(item ?? null) ?? null);
}

// Longest-common-subsequence pairs [i, j] (in order) between two lists of
// strings. Lists here are a block's bullets or items (or a cover letter's
// paragraphs, letters/letterAi.js), so they're short.
export function lcsPairs(a, b) {
  const table = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// True when `b` holds exactly `a`'s entries in another order.
/**
 * @param {string[]} a
 * @param {string[]} b
 */
function isReordering(a, b) {
  if (a.length !== b.length || a.every((entry, i) => entry === b[i])) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((entry, i) => entry === sorted[i]);
}

// Bullet and item proposals are tied to a position, and positions shift
// when bullets or items are dragged, deleted, or added. Returns where the
// proposal applies now, by aligning the bullets (or items) at its depth in
// `proposal.anchorData` (the block data its `target` was last placed
// against; baseData until EditorPage first relocates it) with the current
// ones. EditorPage advances the anchor on every change to the block, so
// each call only has to resolve one edit, insert, delete, or move, which
// these rules can always tell apart:
// 0. If only custom item dates changed (every position the same with
//    dates ignored), nothing moved. The rules below compare items with
//    their dates (placeJson), to tell entries apart that differ only by
//    date, which a date edit alone mustn't turn into a move. For custom
//    items, what a single change leaves behind is also read exactly
//    before the rules below, which pair by content and can be misled
//    once an edit makes two items read alike: one item changed in place
//    moves nothing; the anchor's own items in another order (no edit does
//    that) put the proposal on the one item that reads exactly like its
//    own, however many moved (and drop it when an exact copy of its
//    own moved, since nothing says which); and one item removed takes the proposal
//    with it when it's the proposal's, or one of several exact copies of
//    it (the data is the same whichever went), and otherwise only shifts
//    it.
// 1. Unchanged bullets are paired in order (longest common subsequence).
//    If the proposal's own bullet is paired, that's where it is now: this
//    follows inserts and deletes above it.
// 2. Otherwise, if the unpaired stretch around it has the same length in
//    both lists, it was edited in place: it keeps its relative spot there,
//    stale. An identical bullet elsewhere is already paired with its own
//    original, so the proposal can't jump onto it.
// 3. Otherwise, the one unpaired current bullet with exactly its original
//    content is where it was dragged to (a sub-bullet only matches
//    sub-bullets).
// 4. Otherwise it can't be placed: null when its current position is gone,
//    else it stays where it is (stale). A custom item proposal is dropped
//    instead when it wouldn't be stale there: its own entry is gone, and
//    what holds its position is another one that reads the same with
//    dates ignored (another year's), which it would be accepted over.
// Returns `proposal.target` itself when nothing moved, so callers can
// compare by identity. Other targets never move.
/**
 * @param {string} type
 * @param {AiProposal} proposal
 * @param {Record<string, any> | null | undefined} currentData
 * @returns {AiTarget | null}
 */
export function relocateTarget(type, proposal, currentData) {
  const { target } = proposal;
  if (target?.kind !== 'bullet' && target?.kind !== 'item') return target;
  const anchor = proposal.anchorData ?? proposal.baseData;
  const depth = (t) => (t.kind === 'bullet' ? t.path.length : 0);
  const sameDepth = (t) => depth(t) === depth(target);
  const here = targetSlice(type, currentData, target);
  const stay = here === null ? null : target;
  const keep = (t) => (targetKey(t) === targetKey(target) ? target : t);

  const basePositions = positionsOf(anchor, target.kind).filter(sameDepth);
  const currentPositions = positionsOf(currentData, target.kind).filter(sameDepth);
  const o = basePositions.findIndex((t) => targetKey(t) === targetKey(target));
  if (o === -1) return stay;
  const a = basePositions.map((t) => placeJson(type, anchor, t));
  const b = currentPositions.map((t) => placeJson(type, currentData, t));
  if (type === 'custom' && target.kind === 'item') {
    // What one change to the items leaves behind is read exactly, before
    // the rules below guess: they pair by content, and an edit can make
    // an item read like another one (a date typed until two awards match).
    const copiesIn = (list) => list.filter((entry) => entry === a[o]).length;
    const changed = a.length === b.length ? a.filter((entry, i) => entry !== b[i]).length : -1;
    // One item edited in place (its date, its text): nothing moved, even
    // if it now reads like the proposal's own.
    if (changed === 0 || changed === 1) return stay;
    if (isReordering(a, b)) {
      // The same items in another order (entries that differ only by date
      // included: the 2020 and 2021 awards swapped), which no edit leaves
      // behind. The proposal's own is the one that reads exactly like it,
      // wherever it went and however many others moved. With exact copies
      // of it, it stays while they all hold the positions they did (the
      // others moved around them); once a copy moved, nothing says which
      // one, so the proposal goes rather than follow the wrong one.
      if (copiesIn(b) === 1) return keep(currentPositions[b.indexOf(a[o])]);
      return a.every((entry, i) => (entry === a[o]) === (b[i] === a[o])) ? stay : null;
    } else if (changed > 1 && basePositions.every((t, i) => sliceJson(type, anchor, t) === sliceJson(type, currentData, currentPositions[i]))) {
      // Nothing but dates changed (the same items in the same places):
      // every proposal stays put. Matching by date could otherwise pair a
      // twin with the wrong one when a date edit makes two items
      // identical, or tell two apart that a cleared date made the same.
      return stay;
    } else if (b.length === a.length - 1) {
      // One item removed: every index whose removal leaves this list (more
      // than one when it had exact copies side by side). The proposal goes
      // with its own item, and also when its item is one of several copies
      // that may have been the one removed, since the data is the same
      // either way; otherwise it only shifts up past the gap.
      const removed = a.map((_, d) => d).filter((d) => a.every((entry, i) => i === d || entry === b[i < d ? i : i - 1]));
      if (removed.includes(o)) return null;
      if (removed.length > 0) return keep(currentPositions[removed[0] < o ? o - 1 : o]);
    }
    // Several changes at once (a block rewrite accepted, say) that left
    // fewer exact copies of the proposal's item in a shorter list: one of
    // them went, and the data can't say which.
    if (b.length < a.length && copiesIn(a) > 1 && copiesIn(b) < copiesIn(a)) return null;
  }
  const pairs = lcsPairs(a, b);

  const paired = pairs.find(([i]) => i === o);
  if (paired) return keep(currentPositions[paired[1]]);

  let before = [-1, -1];
  let after = [a.length, b.length];
  for (const pair of pairs) {
    if (pair[0] < o) before = pair;
    else {
      after = pair;
      break;
    }
  }
  if (after[0] - before[0] === after[1] - before[1]) return keep(currentPositions[before[1] + (o - before[0])]);

  const pairedCurrent = new Set(pairs.map(([, j]) => j));
  const moved = b.map((_, j) => j).filter((j) => !pairedCurrent.has(j) && b[j] === a[o]);
  if (moved.length === 1) return keep(currentPositions[moved[0]]);
  // Staying put relies on the proposal going stale, which over a custom
  // item that reads as the one it was made for with dates ignored (the
  // same entry from another year, its own one deleted, whether or not it
  // was edited first) it wouldn't: it would show and be accepted over the
  // wrong item. Its item is gone, so the proposal goes too.
  if (stay && type === 'custom' && target.kind === 'item' && !isProposalStale(type, proposal, currentData)) return null;
  return stay;
}

// A rewrite still loading for a bullet or item is followed like a ready
// proposal (EditorPage), so a response never lands on whatever took its
// position meanwhile. `request` is { asked, baseData, target, anchorData }:
// the position asked for in the block data the request was sent with,
// where it is now, and the data that was last placed against (at first,
// `asked` and `baseData`). Returns where it is now, `request.target`
// itself when nothing moved, or null when its bullet or item is gone.
/**
 * @typedef {{ asked: AiTarget, baseData: Record<string, any>, target: AiTarget, anchorData: Record<string, any>, itemsChanged?: boolean }} LoadingRequest
 */
/**
 * @param {string} type
 * @param {LoadingRequest} request
 * @param {Record<string, any> | null | undefined} currentData
 * @returns {AiTarget | null}
 */
export function relocateRequest(type, request, currentData) {
  const { asked, baseData, target, anchorData } = request;
  return relocateTarget(type, { blockId: '', target, origin: asked, baseData, anchorData, proposedData: baseData }, currentData);
}

// A proposal as it lands for a request that was followed while it loaded:
// placed where relocateRequest left it, its text still at `asked` in its
// own baseData and proposedData. A custom block's keeps the note that its
// item count differed meanwhile (itemCountChanged).
/**
 * @param {AiProposal} proposal
 * @param {LoadingRequest} request
 * @returns {AiProposal}
 */
export function landProposal(proposal, request) {
  const { asked, target, anchorData } = request;
  if (request.itemsChanged) return { ...proposal, itemsChanged: true };
  if (asked?.kind !== 'bullet' && asked?.kind !== 'item') return proposal;
  const moved = targetKey(target) !== targetKey(asked);
  return { ...proposal, ...(moved ? { target, origin: asked } : {}), anchorData };
}

// `currentData` with the proposal's target replaced by what the proposal
// says, and nothing else touched, so proposals for different parts of one
// block can be accepted (or previewed) one after another. A bullet or item
// that is no longer there leaves the data as it is.
/**
 * @param {string} type
 * @param {Record<string, any> | null | undefined} currentData
 * @param {AiProposal} proposal
 * @returns {Record<string, any>}
 */
export function applyProposal(type, currentData, proposal) {
  currentData = currentData || {};
  const { target, proposedData } = proposal;
  // Of the target's own kind: relocation only ever moves a bullet or item
  // to another position of its kind.
  const origin = /** @type {any} */ (originOf(proposal));
  switch (target?.kind) {
    case 'description':
      return proposedData.description === undefined ? currentData : { ...currentData, description: proposedData.description };
    case 'bullet': {
      const replacement = bulletAt(normalizedBullets(proposedData), origin.path);
      if (!replacement || !bulletAt(normalizedBullets(currentData), target.path)) return currentData;
      // updateAtPath spreads the bullets on the way down, so a legacy string
      // bullet on the path is normalized first; every other entry is kept
      // exactly as stored.
      const [first] = target.path;
      const bullets = currentData.bullets.map((b, i) => (i === first ? normalizeBullet(b) : b));
      return { ...currentData, bullets: updateAtPath(bullets, target.path, () => replacement) };
    }
    case 'item': {
      const replacement = proposedData.items?.[origin.index];
      if (!replacement || !Array.isArray(currentData.items) || target.index >= currentData.items.length) return currentData;
      return {
        ...currentData,
        items: currentData.items.map((item, i) => (i === target.index ? withDateOf(replacement, item) : item)),
      };
    }
    default: {
      // A custom block's item dates, like an experience description below,
      // are the current ones: the proposal's are only copies. Items have no
      // ids, so a current date is matched to a proposed item by position,
      // and only while the proposal isn't stale (every item but its date is
      // as the proposal was made for, so position i is still the same
      // item, or one it words the same). Once items were added, removed,
      // reordered or edited, the positions can't be trusted, and the
      // proposal keeps the dates it was made against, which a rewrite never
      // changes.
      if (type === 'custom') {
        const items = proposedData.items;
        const current = currentData.items;
        if (!Array.isArray(items) || !Array.isArray(current) || items.length !== current.length) return proposedData;
        if (isProposalStale(type, proposal, currentData)) return proposedData;
        return { ...proposedData, items: items.map((item, i) => withDateOf(item, current[i])) };
      }
      // The proposal's description is just the old one copied through, so
      // keep the current one: accepting mustn't undo a description edit (or
      // an accepted description rewrite) made since.
      if (type !== 'experience') return proposedData;
      const next = withoutDescription(type, proposedData);
      return currentData.description === undefined ? next : { ...next, description: currentData.description };
    }
  }
}

// The block data the preview shows with every one of its ready proposals
// applied. Whole-block proposals go first, since they replace everything
// they own; the narrower ones are then laid over them in the order given.
// A bullet or item proposal whose spot no longer holds what it was made for
// is left out: it would otherwise show over a different bullet. Its panel
// still offers it, with the out-of-date warning.
/**
 * @param {string} type
 * @param {Record<string, any>} data
 * @param {AiProposal[]} proposals
 */
export function previewData(type, data, proposals) {
  return previewedProposals(type, data, proposals).reduce((current, proposal) => applyProposal(type, current, proposal), data);
}

// What the preview banner's "Accept all" saves, given every block and every
// ready proposal: for each block, the proposals previewedProposals shows,
// applied in its order, minus whole-block ones the block has been edited
// since. The preview still shows those (see previewedProposals), but a
// single Accept asks before replacing the edits, and a bulk one can't ask
// about each, so they stay open in their panels. Returns { changes:
// [{ blockId, data }], accepted, skipped } (proposals), the skipped ones
// being those left open.
/**
 * @param {{ id: string, type: string, data: Record<string, any> }[]} blocks
 * @param {AiProposal[]} proposals
 * @returns {{ changes: { blockId: string, data: Record<string, any> }[], accepted: AiProposal[], skipped: AiProposal[] }}
 */
export function acceptAllPlan(blocks, proposals) {
  const changes = [];
  const accepted = [];
  const skipped = [];
  for (const block of blocks) {
    const mine = proposals.filter((p) => p.blockId === block.id);
    if (mine.length === 0) continue;
    const shown = previewedProposals(block.type, block.data, mine);
    const fresh = shown.filter((p) => !(targetKey(p.target) === 'block' && isProposalStale(block.type, p, block.data)));
    skipped.push(...mine.filter((p) => !fresh.includes(p)));
    if (fresh.length === 0) continue;
    accepted.push(...fresh);
    changes.push({ blockId: block.id, data: fresh.reduce((current, p) => applyProposal(block.type, current, p), block.data) });
  }
  return { changes, accepted, skipped };
}

// The proposals previewData lays over a block's data, in the order it
// applies them. The banner counts these and the preview outlines their
// blocks, so neither claims a rewrite the preview isn't showing.
//
// Whole-block proposals always show (they replace everything they own).
// A narrower one (description, bullet, item) shows only while the part it
// rewrites is unchanged in the real data since it was made: once edited,
// it's left out, and its panel says so. A bullet or item proposal also
// needs its position to still mean the same bullet or item, so it is left
// out under a whole-block rewrite that was allowed to restructure bullets
// (it may have added, removed, merged, or reordered them). A reword-only
// block rewrite keeps every position, and a custom block rewrite can't
// change its item count, so a bullet or item rewrite still shows over those.
/**
 * @param {string} type
 * @param {Record<string, any>} data
 * @param {AiProposal[]} proposals
 * @returns {AiProposal[]}
 */
export function previewedProposals(type, data, proposals) {
  const isBlock = (p) => targetKey(p.target) === 'block';
  const blocks = proposals.filter(isBlock);
  const restructured = blocks.some((p) => p.allowBulletRestructure);
  // A top-level bullet rewrite that may restructure its sub-bullets makes
  // positions under it unreliable too, so a sub-bullet rewrite of the same
  // bullet is left out while it is open.
  const restructuredBullets = new Set(
    proposals
      .filter((p) => p.target?.kind === 'bullet' && p.target.path.length === 1 && p.allowBulletRestructure)
      .map((p) => /** @type {{ path: number[] }} */ (p.target).path[0])
  );
  const underRestructured = (p) =>
    p.target.kind === 'bullet' && p.target.path.length === 2 && restructuredBullets.has(p.target.path[0]);
  const narrow = proposals.filter(
    (p) =>
      !isBlock(p) &&
      !isProposalStale(type, p, data) &&
      !((p.target.kind === 'bullet' && restructured) || underRestructured(p))
  );
  return [...blocks, ...narrow];
}

export const AI_PRESETS = [
  { label: 'Tighten', instruction: 'Make this more concise without losing any substance.' },
  {
    label: 'Quantify impact',
    instruction:
      'Emphasize measurable impact. Where a number would help but none is given, add a bracketed placeholder like [X%] for me to fill in.',
  },
  { label: 'Stronger verbs', instruction: 'Start statements with strong, specific action verbs and use active voice.' },
  { label: 'Fix grammar', instruction: 'Fix grammar, spelling, and punctuation only. Change nothing else.' },
];

// The tense a custom block's picker shows: the pick made in this panel, or
// else the tense setting's default, so changing the setting still moves an
// untouched picker, or else the first option. All come from the server
// (publicAiSettings): `options` is its `pickedTenses` (id → { label }). A
// pick or default that isn't among the options (settings reloaded since) is
// skipped, so the select never shows a blank value or sends a stale id.
export function pickerTense(picked, defaultTense, options) {
  options ??= {};
  const offered = (id) => typeof id === 'string' && Object.hasOwn(options, id);
  if (offered(picked)) return picked;
  if (offered(defaultTense)) return defaultTense;
  return Object.keys(options)[0];
}

// A note for a proposal written with a different tense than the picker now
// shows, or null. `options` is the settings' `pickedTenses` (id → { label }).
export function tenseChangeNote(usedTense, currentTense, options) {
  if (!usedTense || usedTense === currentTense) return null;
  const label = (id) => options?.[id]?.label || id;
  return `This rewrite used “${label(usedTense)}”. Try again to use “${label(currentTense)}”.`;
}

// An executive summary is written from the rest of the resume (the server
// sends it an outline; see brief.js's outlineScope), so its presets start
// with drafting it from there.
const EXECUTIVE_SUMMARY_PRESETS = [
  {
    label: 'Draft from my resume',
    instruction:
      'Write this executive summary from my resume: a one-line headline, an overview of three to five sentences, and three to five key highlights drawn from my experience. Replace what is here.',
  },
  {
    label: 'Pick highlights',
    instruction:
      'Choose three to five key career highlights from my experience, each leading with the result. Leave the headline and overview as they are.',
  },
];

// The presets for one rewrite. An experience description gets its own:
// "Write description" when there isn't one yet (the general presets have
// nothing to work on then), and "Rewrite description" after the general
// ones otherwise.
export function presetsFor(type, data = {}, target = BLOCK_TARGET) {
  if (type === 'executive_summary') return [...EXECUTIVE_SUMMARY_PRESETS, ...AI_PRESETS];
  if (type !== 'experience' || target?.kind !== 'description') return AI_PRESETS;
  if (!data.description?.trim()) {
    return [
      {
        label: 'Write description',
        instruction:
          'Write a short description of this role (two or three sentences) summarizing its scope and focus, based only on the details already here.',
      },
    ];
  }
  return [...AI_PRESETS, { label: 'Rewrite description', instruction: 'Rewrite the description so it reads clearly and confidently.' }];
}

// Splits into words with their trailing whitespace attached, so joining the
// parts reproduces the original text exactly. Keeping spaces out of their
// own tokens stops them from anchoring matches, which would otherwise
// interleave a rewritten phrase into alternating struck/added words.
function tokenize(text) {
  return String(text || '').match(/\s+|\S+\s*/g) || [];
}

// Word-level diff via longest common subsequence. Returns runs of
// { type: 'same' | 'add' | 'del', text }, adjacent runs of one type merged.
export function wordDiff(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const runs = [];
  const push = (type, text) => {
    const last = runs[runs.length - 1];
    if (last && last.type === type) last.text += text;
    else runs.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push('same', a[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('del', a[i++]);
    } else {
      push('add', b[j++]);
    }
  }
  while (i < a.length) push('del', a[i++]);
  while (j < b.length) push('add', b[j++]);
  return runs;
}

const CUSTOM_BODY_FIELD = { text: 'text', list: 'items', tags: 'items', link: 'label' };

// An executive summary's highlights as one line each, for the diff. Blank
// ones render as nothing, so they don't count as a change either.
const highlightLines = (highlights) =>
  (Array.isArray(highlights) ? highlights : [])
    .map((h) => String(h ?? '').trim())
    .filter(Boolean)
    .join('\n');

function customBody(item) {
  if (!item.bodyType) return item.text ?? item.body ?? '';
  return item[CUSTOM_BODY_FIELD[item.bodyType] || 'text'] || '';
}

// The non-bullet text fields an AI rewrite of `target` can change, as
// { label, before, after } — only the ones that actually changed. Bullets
// are reviewed separately from the server's bulletReview.
export function changedFields(type, before = {}, after = {}, target = BLOCK_TARGET) {
  const fields = [];
  const add = (label, b, a) => {
    if ((b || '') !== (a || '')) fields.push({ label, before: b || '', after: a || '' });
  };
  switch (target?.kind) {
    case 'description':
      add('Description', before.description, after.description);
      return fields;
    case 'bullet':
      return fields;
    case 'item': {
      const item = (before.items || [])[target.index] || {};
      const next = (after.items || [])[target.index] || {};
      add('Heading', item.heading, next.heading);
      add('Item', customBody(item), customBody(next));
      return fields;
    }
    default:
      break;
  }
  switch (type) {
    case 'heading':
      add('Heading', before.text, after.text);
      break;
    case 'summary':
      add('Summary', before.text, after.text);
      break;
    case 'executive_summary':
      add('Headline', before.headline, after.headline);
      add('Overview', before.text, after.text);
      add('Key highlights', highlightLines(before.highlights), highlightLines(after.highlights));
      break;
    case 'skills_group':
      add('Category', before.category, after.category);
      add('Items', before.items, after.items);
      break;
    case 'experience':
      add('Tagline', before.tagline, after.tagline);
      add('Description', before.description, after.description);
      break;
    case 'custom': {
      add('Section title', before.title, after.title);
      const items = before.items || [];
      items.forEach((item, i) => {
        const next = (after.items || [])[i] || {};
        add(`Item ${i + 1} heading`, item.heading, next.heading);
        add(`Item ${i + 1}`, customBody(item), customBody(next));
      });
      break;
    }
    default:
      break;
  }
  return fields;
}

// How many of an experience block's bullets (sub-bullets included) are
// hidden from web or print. A sub-bullet of a hidden bullet is hidden with
// it, matching what the server marks as hidden for the AI (rewritableFields.js).
// Their text is sent to the AI along with the rest, so the panel says so
// before the user sends anything.
export function hiddenBulletCount(type, data = {}) {
  if (type !== 'experience') return 0;
  const count = (bullets, parentHidden) =>
    (Array.isArray(bullets) ? bullets : []).reduce((n, b) => {
      if (!b || typeof b !== 'object') return n + (parentHidden ? 1 : 0);
      const hidden = parentHidden || b.visibleWeb === false || b.visiblePrint === false;
      return n + (hidden ? 1 : 0) + count(b.children, hidden);
    }, 0);
  return count(data.bullets, false);
}

// What the panel says is sent along besides the block itself, or null.
// Mirrors brief.js's outlineScope for rewrites without a brief.
export function contextNote(type) {
  if (type !== 'executive_summary') return null;
  return 'An outline of the rest of this resume is sent to the AI too: job titles, companies, dates, taglines, descriptions, bullets, skills, education, credentials and languages, leaving out anything hidden where this block shows.';
}

// What happened to one bullet in the server's bulletReview, for its label.
export function bulletChange(item) {
  if (item.before === null) return 'added';
  return item.before === item.after ? 'unchanged' : 'reworded';
}

// True when the part of the block the proposal is for changed after it was
// generated — accepting would then silently overwrite those edits. Edits to
// other parts don't count: accepting only writes the target. A bullet or
// item is compared at its original position in baseData and its current
// one in `currentData` (see relocateTarget); one that left its position
// without being found elsewhere counts as changed.
/**
 * @param {string} type
 * @param {AiProposal} proposal
 * @param {Record<string, any> | null | undefined} currentData
 */
export function isProposalStale(type, proposal, currentData) {
  if (sliceJson(type, proposal.baseData, originOf(proposal)) !== sliceJson(type, currentData, proposal.target)) return true;
  if (type !== 'custom' || targetKey(proposal.target) !== 'block') return false;
  return Boolean(proposal.itemsChanged) || twinsRedated(proposal, currentData);
}

// A custom block proposal goes by position, with dates ignored, so it
// can't see an item removed and another added that reads the same but for
// its date (last year's award deleted, this year's typed in): the data is
// what a date edit would leave. EditorPage therefore notes on the proposal
// (and on a request still loading) once the block's item count has
// differed from what it was made against, and it's stale from then on,
// whatever the items read later.
/**
 * @param {string} type
 * @param {AiTarget | null | undefined} target
 * @param {Record<string, any> | null | undefined} baseData
 * @param {Record<string, any> | null | undefined} currentData
 */
export function itemCountChanged(type, target, baseData, currentData) {
  if (type !== 'custom' || targetKey(target) !== 'block') return false;
  const count = (data) => (Array.isArray(data?.items) ? data.items.length : 0);
  return count(baseData) !== count(currentData);
}

// A custom block proposal goes by position, and a date edit doesn't make
// it stale. That leaves one case where its positions can't be trusted
// though nothing but dates differs: entries that are the same but for
// their date (the same award in 2020 and 2021), which the proposal words
// differently, and whose dates aren't the ones it was made against. The
// date is all that tells such entries apart, so they may have been
// reordered, or one deleted and another added, and each would get the
// other's rewrite. Entries the proposal words alike can't be mixed up,
// and a date edited on any other item is still just a date edit.
/**
 * @param {AiProposal} proposal
 * @param {Record<string, any> | null | undefined} currentData
 */
function twinsRedated(proposal, currentData) {
  const base = proposal.baseData?.items;
  const proposed = proposal.proposedData?.items;
  const current = currentData?.items;
  if (!Array.isArray(base) || !Array.isArray(proposed) || !Array.isArray(current)) return false;
  if (base.length !== proposed.length || base.length !== current.length) return false;
  const dateless = (item) => JSON.stringify(comparableItem(withoutDate(item ?? null)) ?? null);
  const dateOf = (item) => (typeof item?.date === 'string' ? item.date : '');
  /** @type {Map<string, number[]>} */
  const twins = new Map();
  base.forEach((item, i) => twins.set(dateless(item), [...(twins.get(dateless(item)) || []), i]));
  for (const group of twins.values()) {
    if (group.length < 2) continue;
    if (group.every((i) => dateless(proposed[i]) === dateless(proposed[group[0]]))) continue;
    if (group.some((i) => dateOf(current[i]) !== dateOf(base[i]))) return true;
  }
  return false;
}
