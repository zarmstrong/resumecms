// A tailoring plan in the editor (issue #84): the AI's suggestions of what
// to hide for a brief, and a new section order, from POST …/ai/tailor-plan
// (server/src/ai/tailorPlan.js). Like a rewrite, each suggestion is only a
// proposal until accepted: the preview shows it, and accepting it goes
// through the editor's usual visibility, block-data and reorder saves.
// Pure, so tailorPlan.test.js covers it without React.
import { normalizeBullet } from '../resume/bulletUtils.js';
import { bulletAt, updateAtPath } from './bulletDrag.js';
import { acceptAllPlan, isProposalStale, proposalKey, relocateTarget } from './aiReview.js';

// The dialogs' "Hide from" choice, as the server's HIDE_FROM.
export const HIDE_FROM = Object.freeze({ both: ['web', 'print'], print: ['print'] });
export const DEFAULT_HIDE_FROM = 'both';
export const HIDE_FROM_LABELS = { both: 'the web page and the PDF', print: 'the PDF only' };

const FLAG = { web: 'visibleWeb', print: 'visiblePrint' };
// The patch that hides something on `surfaces`.
const offOn = (surfaces) => Object.fromEntries(surfaces.map((s) => [FLAG[s], false]));
const bulletsOf = (data) => (Array.isArray(data?.bullets) ? data.bullets.map((b) => normalizeBullet(b)) : []);

// A hide's target, for proposalKey (aiReview.js's targetKey has a case for it).
export const hideTarget = (hide) => (hide.path ? { kind: 'hide', path: hide.path } : { kind: 'hide' });
export const hideKey = (hide) => proposalKey(hide.blockId, hideTarget(hide));

// The plan as the editor keeps it, from the server's response: each hide
// gets the surfaces it's for and, for a bullet, the block data it was placed
// against (`anchorData`, as relocateTarget reads it), and the order gets the
// nesting it was made for, since a reorder only works with that nesting.
// Hides of blocks this editor no longer has are dropped. Returns
// { hides: { [key]: hide }, order }.
export function receivePlan(plan, blocks, hideFrom = DEFAULT_HIDE_FROM) {
  const surfaces = HIDE_FROM[hideFrom] || HIDE_FROM[DEFAULT_HIDE_FROM];
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const hides = {};
  for (const hide of plan?.hides || []) {
    const block = byId.get(hide.blockId);
    if (!block || hide.blockIds.some((id) => !byId.has(id))) continue;
    const entry = { ...hide, surfaces, ...(hide.path ? { anchorData: block.data } : {}) };
    hides[hideKey(entry)] = { ...entry, key: hideKey(entry) };
  }
  const order = plan?.order
    ? { ...plan.order, basisParents: Object.fromEntries(blocks.map((b) => [b.id, b.parentId ?? null])) }
    : null;
  return { hides, order };
}

// Block data with the bullet at `path` hidden on `surfaces`. A legacy
// string bullet on the path is normalized first, as applyProposal does.
export function hideBulletInData(data, path, surfaces) {
  const bullets = Array.isArray(data?.bullets) ? data.bullets : [];
  if (!bulletAt(bulletsOf(data), path)) return data;
  const normalized = bullets.map((b, i) => (i === path[0] ? normalizeBullet(b) : b));
  return { ...data, bullets: updateAtPath(normalized, path, (b) => ({ ...b, ...offOn(surfaces) })) };
}

// The blocks with `hide` applied: its blocks' flags off on its surfaces, or
// its bullet's.
export function applyHide(blocks, hide) {
  if (hide.path) {
    return blocks.map((b) => (b.id === hide.blockId ? { ...b, data: hideBulletInData(b.data, hide.path, hide.surfaces) } : b));
  }
  const ids = new Set(hide.blockIds);
  return blocks.map((b) => (ids.has(b.id) ? { ...b, ...offOn(hide.surfaces) } : b));
}

// What accepting a block or section hide saves: one visibility patch per
// block that still shows on one of its surfaces.
export function hidePatches(blocks, hide) {
  const ids = new Set(hide.blockIds);
  return blocks
    .filter((b) => ids.has(b.id))
    .map((b) => ({ blockId: b.id, patch: Object.fromEntries(hide.surfaces.filter((s) => b[FLAG[s]]).map((s) => [FLAG[s], false])) }))
    .filter(({ patch }) => Object.keys(patch).length > 0);
}

// The blocks in the order's display order. A block it doesn't list (added
// since) goes last, as the server lists a new one.
export function applyOrder(blocks, order) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const listed = order.blockIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
  const rest = blocks.filter((b) => !order.blockIds.includes(b.id));
  return [...listed, ...rest];
}

// The ids in a top-level heading's section, as the server's draftTree()
// sees it: the blocks nested under it, then the top-level blocks after it
// up to the next heading (which a resume made before nesting relies on).
// `blocks` is in display order.
export function sectionMembers(blocks, headingId) {
  const headings = new Set(blocks.filter((b) => b.type === 'heading' && b.parentId == null).map((b) => b.id));
  const members = [];
  let open = null;
  for (const block of blocks) {
    if (block.parentId != null && headings.has(block.parentId)) {
      if (block.parentId === headingId) members.push(block.id);
    } else if (headings.has(block.id)) open = block.id;
    else if (open === headingId) members.push(block.id);
  }
  return members;
}

// Whether everything `hide` would hide already is: hidden by hand since,
// so there's nothing left to accept.
export function isHideApplied(blocks, hide) {
  if (hide.path) {
    const block = blocks.find((b) => b.id === hide.blockId);
    const bullet = block && bulletAt(bulletsOf(block.data), hide.path);
    return Boolean(bullet) && hide.surfaces.every((s) => !bullet[FLAG[s]]);
  }
  const ids = new Set(hide.blockIds);
  const mine = blocks.filter((b) => ids.has(b.id));
  return mine.length > 0 && mine.every((b) => hide.surfaces.every((s) => !b[FLAG[s]]));
}

// True once what the hide was made for has changed: a block's (or a
// section heading's) flags, the blocks in a section, or a bullet's text or
// flags at its (relocated) path. A stale hide stays in its panel with a
// note, but the preview and Accept all leave it out.
export function isHideStale(blocks, hide) {
  const block = blocks.find((b) => b.id === hide.blockId);
  if (!block) return true;
  const { before } = hide;
  if (hide.path) {
    const bullet = bulletAt(bulletsOf(block.data), hide.path);
    return !bullet || bullet.text !== before.text || bullet.visibleWeb !== before.visibleWeb || bullet.visiblePrint !== before.visiblePrint;
  }
  if (block.visibleWeb !== before.visibleWeb || block.visiblePrint !== before.visiblePrint) return true;
  if (hide.section) {
    // The same blocks in any order: accepting the plan's order can reorder
    // the section without changing what hiding it hides.
    const now = sectionMembers(blocks, hide.blockId);
    const then = new Set(hide.blockIds.slice(1));
    return now.length !== then.size || now.some((id) => !then.has(id));
  }
  return false;
}

// True once the blocks, their order or their nesting differ from what the
// order was made against: applying it then could split a section or lose a
// block, so it has to be asked for again.
export function isOrderStale(blocks, order) {
  if (blocks.length !== order.basis.length) return true;
  return blocks.some((b, i) => b.id !== order.basis[i] || (b.parentId ?? null) !== order.basisParents[b.id]);
}

// Where a bullet hide applies now that its block's bullets may have moved
// (relocateTarget's rules, at the bullet's depth): the hide re-placed, the
// same hide when nothing moved, or null when its bullet is gone.
export function relocateHide(hide, currentData) {
  const target = { kind: 'bullet', path: hide.path };
  const placed = relocateTarget('experience', { target, anchorData: hide.anchorData, baseData: hide.anchorData }, currentData);
  if (placed === null) return null;
  if (placed === target) return hide.anchorData === currentData ? hide : { ...hide, anchorData: currentData };
  const moved = { ...hide, path: placed.path, anchorData: currentData };
  return { ...moved, key: hideKey(moved) };
}

// The rewrites open on a block whose bullets can't be trusted to keep their
// positions: a whole-block rewrite allowed to restructure bullets moves
// every bullet hide under it, and a bullet rewrite allowed to restructure
// its sub-bullets moves the sub-bullet hides under that bullet. Those hides
// are left out of the preview and Accept all while it's open, as
// aiReview.js's previewedProposals does for bullet rewrites.
function restructuredUnder(hide, proposals) {
  return proposals.some(
    (p) =>
      p.blockId === hide.blockId &&
      p.allowBulletRestructure &&
      ((p.target?.kind ?? 'block') === 'block' || (p.target?.kind === 'bullet' && p.target.path.length === 1 && hide.path.length === 2 && p.target.path[0] === hide.path[0]))
  );
}

// The hides the preview shows (and Accept all takes): every one that isn't
// stale, already applied, or under a restructuring rewrite.
export function previewedHides(blocks, hides, proposals = []) {
  return Object.values(hides).filter(
    (hide) => !isHideStale(blocks, hide) && !isHideApplied(blocks, hide) && !(hide.path && restructuredUnder(hide, proposals))
  );
}

// The blocks the preview shows: rewrites first (`rewritten`, the blocks
// with every previewed rewrite applied), then the hides, then the order.
export function previewPlan(rewritten, blocks, hides, order, proposals = []) {
  let shown = previewedHides(blocks, hides, proposals).reduce((current, hide) => applyHide(current, hide), rewritten);
  if (order && !isOrderStale(blocks, order)) shown = applyOrder(shown, order);
  return shown;
}

// An open rewrite of the block a bullet hide was just accepted on, with the
// same bullet hidden in its baseData and proposedData, so it doesn't turn
// stale over a flag it never meant to change, and accepting it later
// doesn't show the bullet again. Only a rewrite that's still fresh, and
// can't have moved the bullet, is updated; any other comes back as it was.
// `currentData` is the block's data before the hide.
export function rebaseOnBulletHide(type, proposal, currentData, path, surfaces) {
  const kind = proposal.target?.kind ?? 'block';
  let originPath;
  if (kind === 'block') {
    if (type !== 'experience' || proposal.allowBulletRestructure) return proposal;
    originPath = path;
  } else if (kind === 'bullet') {
    const own = proposal.target.path;
    if (own.length > path.length || own.some((i, d) => i !== path[d])) return proposal;
    if (own.length === 1 && path.length === 2 && proposal.allowBulletRestructure) return proposal;
    originPath = [...(proposal.origin || proposal.target).path, ...path.slice(own.length)];
  } else {
    return proposal;
  }
  if (isProposalStale(type, proposal, currentData)) return proposal;
  return {
    ...proposal,
    baseData: hideBulletInData(proposal.baseData, originPath, surfaces),
    proposedData: hideBulletInData(proposal.proposedData, originPath, surfaces),
  };
}

// "Accept all": acceptAllPlan()'s rewrites, then the previewed hides and a
// fresh order on top. Bullet hides land in the same data change as their
// block's rewrites; block hides are visibility patches. Returns
// { changes: [{ blockId, data }], patches: [{ blockId, patch }], order,
// accepted (rewrites), skipped (rewrites), hides (keys accepted),
// skippedHides (keys left open), orderStale }.
export function acceptAllWithPlan(blocks, proposals, hides, order) {
  const { changes, accepted, skipped } = acceptAllPlan(blocks, proposals);
  const shown = previewedHides(blocks, hides, proposals);
  const data = new Map(changes.map((c) => [c.blockId, c.data]));
  const patches = [];
  for (const hide of shown) {
    if (hide.path) {
      const current = data.has(hide.blockId) ? data.get(hide.blockId) : blocks.find((b) => b.id === hide.blockId).data;
      data.set(hide.blockId, hideBulletInData(current, hide.path, hide.surfaces));
    } else {
      patches.push(...hidePatches(blocks, hide));
    }
  }
  const shownKeys = new Set(shown.map(hideKey));
  const orderStale = Boolean(order) && isOrderStale(blocks, order);
  return {
    changes: [...data].map(([blockId, d]) => ({ blockId, data: d })),
    patches,
    order: order && !orderStale ? order : null,
    accepted,
    skipped,
    hides: [...shownKeys],
    skippedHides: Object.keys(hides).filter((key) => !shownKeys.has(key)),
    orderStale,
  };
}

// The block ids a tailoring run's text rewrites skip, given the plan: every
// block a block or section hide is for. Credits shouldn't go to text that's
// about to be hidden; a bullet hide skips nothing.
export function suggestedHiddenIds(hides) {
  return new Set(Object.values(hides).filter((h) => !h.path).flatMap((h) => h.blockIds));
}

// "the PDF" / "the web page and the PDF", for a hide's label.
export function surfacesLabel(surfaces) {
  return surfaces.length === 1 ? 'the PDF' : 'the web page and the PDF';
}
