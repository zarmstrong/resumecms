// Bullets inside an experience block have no ids: the editor addresses one by
// its index at each nesting level, e.g. [1] is the second top-level bullet and
// [1, 0] is its first sub-bullet. dnd-kit wants string ids, so a path also
// has a key form ('1.0'). The projection used for the on-screen indicator is
// the same function that produces the saved order, like blockDrag.js.
//
// Every helper tolerates a bullet without a `children` array (rows stored
// before nesting existed, or callers that skip normalizeBullet).

export function pathKey(path) {
  return path.join('.');
}

// Null for anything that isn't a dotted list of non-negative integers, so a
// foreign dnd-kit id can't turn into [NaN] and silently no-op downstream.
export function parsePath(key) {
  // A number is a single index; 1.5 must not be read as the path '1.5'.
  if (typeof key === 'number') return Number.isInteger(key) && key >= 0 ? [key] : null;
  if (typeof key !== 'string') return null;
  const path = key.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  return path.every(Number.isInteger) ? path : null;
}

function childrenOf(bullet) {
  return Array.isArray(bullet?.children) ? bullet.children : [];
}

export function updateAtPath(list, path, update) {
  const [idx, ...rest] = path;
  return list.map((b, i) => {
    if (i !== idx) return b;
    return rest.length === 0 ? update(b) : { ...b, children: updateAtPath(childrenOf(b), rest, update) };
  });
}

export function removeAtPath(list, path) {
  const [idx, ...rest] = path;
  if (rest.length === 0) return list.filter((_, i) => i !== idx);
  return list.map((b, i) => (i === idx ? { ...b, children: removeAtPath(childrenOf(b), rest) } : b));
}

function siblingsAt(list, parentPath) {
  return parentPath.reduce((siblings, idx) => (siblings ? childrenOf(siblings[idx]) : null), list);
}

// The bullet at `path`, or null for a missing or malformed path.
export function bulletAt(list, path) {
  if (!Array.isArray(path) || path.length === 0) return null;
  return siblingsAt(list, path.slice(0, -1))?.[path[path.length - 1]] ?? null;
}

function setSiblings(list, parentPath, siblings) {
  if (parentPath.length === 0) return siblings;
  return updateAtPath(list, parentPath, (b) => ({ ...b, children: siblings }));
}

// Move the bullet at `fromPath` (with its children) to `toIndex` within its
// own sibling array, where `toIndex` is the index after the bullet is taken
// out. Out-of-range indexes are clamped.
export function moveAtPath(list, fromPath, toIndex) {
  const parentPath = fromPath.slice(0, -1);
  const fromIdx = fromPath[fromPath.length - 1];
  const siblings = siblingsAt(list, parentPath);
  if (!siblings || !siblings[fromIdx]) return list;
  const rest = siblings.filter((_, i) => i !== fromIdx);
  const idx = Math.max(0, Math.min(toIndex, rest.length));
  const next = [...rest.slice(0, idx), siblings[fromIdx], ...rest.slice(idx)];
  return setSiblings(list, parentPath, next);
}

function sameParent(a, b) {
  if (a.length !== b.length) return false;
  return a.slice(0, -1).every((idx, i) => idx === b[i]);
}

// The sibling of `activePath` that a pointer over `overPath` targets: the
// row itself when it is a sibling, or its ancestor at the active bullet's
// depth when the pointer is inside a sibling's subtree. Null when the row is
// the active bullet, inside its subtree, or not under the same parent (a
// sub-bullet only reorders among the children of its own parent). The
// before/after half must be judged against that target's whole group, not
// the row the pointer happens to be over.
export function dropTargetPath(activePath, overPath) {
  if (overPath.length < activePath.length) return null;
  const target = overPath.slice(0, activePath.length);
  if (!sameParent(activePath, target)) return null;
  if (target[target.length - 1] === activePath[activePath.length - 1]) return null;
  return target;
}

// Resolve a pointer target into a legal sibling move. Returns null for
// anything that isn't one, including a drop that wouldn't change the order,
// so no indicator shows for it. `anchorKey` is the group the indicator
// attaches to; `edge` is which side of that whole group. The move itself is
// described as `fromPath`/`toIndex` for `moveAtPath`, not as a finished
// array, so the drop can be applied to whatever the bullets are at drop time
// rather than to a copy captured while the pointer was still moving.
export function projectBulletDrop(bullets, activePath, overPath, placement) {
  const target = dropTargetPath(activePath, overPath);
  if (!target) return null;
  const fromIdx = activePath[activePath.length - 1];
  const overIdx = target[target.length - 1];
  const siblings = siblingsAt(bullets, activePath.slice(0, -1));
  if (!siblings?.[fromIdx] || !siblings[overIdx]) return null;
  let toIndex = placement === 'after' ? overIdx + 1 : overIdx;
  if (fromIdx < toIndex) toIndex -= 1;
  if (toIndex === fromIdx) return null;
  return {
    fromPath: activePath,
    toIndex,
    anchorKey: pathKey(target),
    edge: placement,
    label: positionLabel(toIndex, siblings.length, parentAt(bullets, activePath)),
  };
}

function parentAt(bullets, path) {
  return bulletAt(bullets, path.slice(0, -1));
}

// "Position 2 of 3", or for a sub-bullet "Position 2 of 3 under “…”" so a
// listener knows which list is being reordered.
export function positionLabel(index, count, parent = null) {
  const base = `Position ${index + 1} of ${count}`;
  if (!parent) return base;
  const text = (parent.text || '').trim();
  const short = text.length > 40 ? `${text.slice(0, 40)}…` : text || 'empty bullet';
  return `${base} under “${short}”`;
}

// Keyboard reordering: shift the bullet at `path` by `delta` among its
// siblings. Returns the new list, the bullet's new path, and a label for
// the live region, or null when it is already at that end.
export function moveBulletBy(bullets, path, delta) {
  const parentPath = path.slice(0, -1);
  const fromIdx = path[path.length - 1];
  const siblings = siblingsAt(bullets, parentPath);
  if (!siblings?.[fromIdx]) return null;
  const toIndex = fromIdx + delta;
  if (toIndex < 0 || toIndex >= siblings.length) return null;
  return {
    bullets: moveAtPath(bullets, path, toIndex),
    path: [...parentPath, toIndex],
    label: positionLabel(toIndex, siblings.length, parentAt(bullets, path)),
  };
}
