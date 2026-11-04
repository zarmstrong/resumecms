// Pure helpers behind the AI rewrite review panel (AiRewritePanel.jsx).
import { normalizeBullet } from '../resume/bulletUtils.js';
import { bulletAt, updateAtPath } from './bulletDrag.js';

// Mirrors REWRITABLE_TYPES in server/src/ai/rewritableFields.js.
export const AI_REWRITABLE_TYPES = new Set(['heading', 'summary', 'skills_group', 'experience', 'custom']);

// What part of a block a rewrite is aimed at; see the server's
// rewritableFields.js. `block` is the whole block (for an experience block,
// everything but the description), `description` an experience block's
// description, `bullet` one experience bullet by index path ([i] with its
// sub-bullets, or [i, j]), `item` one custom-section item.
export const BLOCK_TARGET = Object.freeze({ kind: 'block' });

// Mirrors targetKey in server/src/ai/rewritableFields.js.
export function targetKey(target) {
  switch (target?.kind) {
    case 'description':
      return 'description';
    case 'bullet':
      return `bullet:${target.path.join('.')}`;
    case 'item':
      return `item:${target.index}`;
    default:
      return 'block';
  }
}

// Proposals are held per block and target, so several can be open at once,
// including several on one block.
export function proposalKey(blockId, target) {
  return `${blockId}:${targetKey(target)}`;
}

// For labels: "bullet 2", "sub-bullet 2.1", "item 3", or null for the block.
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

// The part of `data` a target owns: for a block target, the whole data
// (less an experience description).
export function targetSlice(type, data, target = BLOCK_TARGET) {
  data = data || {};
  switch (target?.kind) {
    case 'description':
      return data.description || '';
    case 'bullet':
      return bulletAt(normalizedBullets(data), target.path);
    case 'item':
      return (Array.isArray(data.items) ? data.items[target.index] : null) ?? null;
    default:
      return withoutDescription(type, data);
  }
}

// Where a proposal's text sits in its own baseData and proposedData. It
// differs from `target` (where it applies now) once the editor has followed
// a moved bullet or item to its new position; see relocateTarget.
const originOf = (proposal) => proposal.origin || proposal.target;

// Every position of one kind in `data`, for relocateTarget.
function positionsOf(data, kind) {
  if (kind === 'bullet') {
    return normalizedBullets(data).flatMap((b, i) => [
      { kind: 'bullet', path: [i] },
      ...b.children.map((_, j) => ({ kind: 'bullet', path: [i, j] })),
    ]);
  }
  return (Array.isArray(data?.items) ? data.items : []).map((_, index) => ({ kind: 'item', index }));
}

const sliceJson = (type, data, target) => JSON.stringify(targetSlice(type, data, target) ?? null);

// Longest-common-subsequence pairs [i, j] (in order) between two lists of
// strings. Lists here are a block's bullets or items, so they're short.
function lcsPairs(a, b) {
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

// Bullet and item proposals are tied to a position, and positions shift
// when bullets or items are dragged, deleted, or added. Returns where the
// proposal applies now, by aligning the bullets (or items) at its depth in
// `proposal.anchorData` (the block data its `target` was last placed
// against; baseData until EditorPage first relocates it) with the current
// ones. EditorPage advances the anchor on every change to the block, so
// each call only has to resolve one edit, insert, delete, or move, which
// these rules can always tell apart:
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
//    else it stays where it is (stale).
// Returns `proposal.target` itself when nothing moved, so callers can
// compare by identity. Other targets never move.
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
  const a = basePositions.map((t) => sliceJson(type, anchor, t));
  const b = currentPositions.map((t) => sliceJson(type, currentData, t));
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
  return stay;
}

// `currentData` with the proposal's target replaced by what the proposal
// says, and nothing else touched, so proposals for different parts of one
// block can be accepted (or previewed) one after another. A bullet or item
// that is no longer there leaves the data as it is.
export function applyProposal(type, currentData, proposal) {
  currentData = currentData || {};
  const { target, proposedData } = proposal;
  const origin = originOf(proposal);
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
      return { ...currentData, items: currentData.items.map((item, i) => (i === target.index ? replacement : item)) };
    }
    default: {
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
export function previewData(type, data, proposals) {
  return previewedProposals(type, data, proposals).reduce((current, proposal) => applyProposal(type, current, proposal), data);
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
      .map((p) => p.target.path[0])
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

// The presets for one rewrite. An experience description gets its own:
// "Write description" when there isn't one yet (the general presets have
// nothing to work on then), and "Rewrite description" after the general
// ones otherwise.
export function presetsFor(type, data = {}, target = BLOCK_TARGET) {
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
export function isProposalStale(type, proposal, currentData) {
  return sliceJson(type, proposal.baseData, originOf(proposal)) !== sliceJson(type, currentData, proposal.target);
}
