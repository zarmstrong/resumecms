import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bulletAt, dropTargetPath, moveAtPath, moveBulletBy, parsePath, pathKey, projectBulletDrop, removeAtPath, updateAtPath,
} from './bulletDrag.js';

const bullet = (text, children = []) => ({ text, visibleWeb: true, visiblePrint: true, children });
const bullets = () => [
  bullet('a', [bullet('a0'), bullet('a1')]),
  bullet('b'),
  bullet('c', [bullet('c0')]),
];
const texts = (list) => list.map((b) => b.text);
const apply = (list, drop) => moveAtPath(list, drop.fromPath, drop.toIndex);

test('path keys round-trip through dnd-kit string ids', () => {
  assert.equal(pathKey([1, 0]), '1.0');
  assert.deepEqual(parsePath('1.0'), [1, 0]);
  assert.deepEqual(parsePath(pathKey([2])), [2]);
  assert.deepEqual(parsePath(3), [3]);
});

test('bulletAt walks a path and returns null for anything missing', () => {
  const list = bullets();
  assert.equal(bulletAt(list, [2, 0]).text, 'c0');
  assert.equal(bulletAt(list, [1]).text, 'b');
  assert.equal(bulletAt(list, [1, 0]), null);
  assert.equal(bulletAt(list, [9]), null);
  assert.equal(bulletAt(list, []), null);
  assert.equal(bulletAt(list, null), null);
  assert.equal(bulletAt([{ text: 'x' }], [0, 0]), null);
});

test('parsePath rejects ids that are not index paths', () => {
  for (const bad of ['', 'a', '1.', '.0', '1..0', '-1', '1.5.x', 'DndDescribedBy-0', null, undefined, {}]) {
    assert.equal(parsePath(bad), null, JSON.stringify(bad));
  }
});

test('updateAtPath and removeAtPath address nested bullets without mutating', () => {
  const list = bullets();
  const snapshot = structuredClone(list);
  const updated = updateAtPath(list, [0, 1], (b) => ({ ...b, text: 'changed' }));
  assert.equal(updated[0].children[1].text, 'changed');
  assert.equal(updated[1], list[1]);
  const removed = removeAtPath(list, [2, 0]);
  assert.deepEqual(removed[2].children, []);
  assert.deepEqual(texts(removeAtPath(list, [1])), ['a', 'c']);
  assert.deepEqual(list, snapshot);
});

test('every helper tolerates bullets stored without a children array', () => {
  const legacy = [{ text: 'x' }, { text: 'y', children: null }, { text: 'z', children: [{ text: 'z0' }] }];
  assert.deepEqual(updateAtPath(legacy, [0, 0], (b) => b), [{ text: 'x', children: [] }, legacy[1], legacy[2]]);
  assert.deepEqual(removeAtPath(legacy, [1, 0])[1], { text: 'y', children: [] });
  assert.deepEqual(texts(moveAtPath(legacy, [2], 0)), ['z', 'x', 'y']);
  assert.equal(moveAtPath(legacy, [0, 0], 1), legacy);
  assert.equal(moveBulletBy(legacy, [1, 0], 1), null);
  assert.equal(projectBulletDrop(legacy, [0, 0], [0, 1], 'after'), null);
  assert.deepEqual(texts(apply(legacy, projectBulletDrop(legacy, [0], [2, 0], 'after'))), ['y', 'z', 'x']);
});

test('moveAtPath moves a top-level bullet with its children and leaves the input alone', () => {
  const list = bullets();
  const snapshot = structuredClone(list);
  const moved = moveAtPath(list, [0], 2);
  assert.deepEqual(texts(moved), ['b', 'c', 'a']);
  assert.equal(moved[2], list[0]);
  assert.deepEqual(texts(moved[2].children), ['a0', 'a1']);
  assert.deepEqual(list, snapshot);
});

test('moveAtPath moves a sub-bullet among its own siblings only', () => {
  const moved = moveAtPath(bullets(), [0, 1], 0);
  assert.deepEqual(texts(moved[0].children), ['a1', 'a0']);
  assert.deepEqual(texts(moved), ['a', 'b', 'c']);
});

test('moveAtPath clamps out-of-range targets and ignores missing paths', () => {
  assert.deepEqual(texts(moveAtPath(bullets(), [0], 99)), ['b', 'c', 'a']);
  assert.deepEqual(texts(moveAtPath(bullets(), [2], -5)), ['c', 'a', 'b']);
  const list = bullets();
  assert.equal(moveAtPath(list, [7], 0), list);
  assert.equal(moveAtPath(list, [1, 3], 0), list);
});

test('dropTargetPath resolves the sibling a hovered row stands for', () => {
  assert.deepEqual(dropTargetPath([1], [2]), [2]);
  assert.deepEqual(dropTargetPath([1], [2, 0]), [2]);
  assert.deepEqual(dropTargetPath([0, 0], [0, 1]), [0, 1]);
  assert.equal(dropTargetPath([1], [1]), null);
  assert.equal(dropTargetPath([1], [1, 0]), null);
  assert.equal(dropTargetPath([0, 0], [1]), null);
  assert.equal(dropTargetPath([0, 0], [2, 0]), null);
});

test('projecting a drop before or after a sibling yields the saved order and indicator', () => {
  const up = projectBulletDrop(bullets(), [2], [0], 'before');
  assert.deepEqual(up, { fromPath: [2], toIndex: 0, anchorKey: '0', edge: 'before', label: 'Position 1 of 3' });
  assert.deepEqual(texts(apply(bullets(), up)), ['c', 'a', 'b']);
  const down = projectBulletDrop(bullets(), [0], [2], 'after');
  assert.deepEqual(down, { fromPath: [0], toIndex: 2, anchorKey: '2', edge: 'after', label: 'Position 3 of 3' });
  assert.deepEqual(texts(apply(bullets(), down)), ['b', 'c', 'a']);
  const mid = projectBulletDrop(bullets(), [0], [1], 'after');
  assert.equal(mid.toIndex, 1);
  assert.deepEqual(texts(apply(bullets(), mid)), ['b', 'a', 'c']);
  assert.equal(mid.label, 'Position 2 of 3');
});

test('a top-level bullet over a sub-bullet lands before or after the whole parent group', () => {
  const after = projectBulletDrop(bullets(), [1], [2, 0], 'after');
  const moved = apply(bullets(), after);
  assert.deepEqual(texts(moved), ['a', 'c', 'b']);
  assert.deepEqual(texts(moved[1].children), ['c0']);
  assert.equal(after.anchorKey, '2');
  assert.equal(after.edge, 'after');
  const before = projectBulletDrop(bullets(), [1], [0, 1], 'before');
  assert.deepEqual(texts(apply(bullets(), before)), ['b', 'a', 'c']);
  assert.equal(before.anchorKey, '0');
});

test('sub-bullets reorder among their own siblings and never across parents', () => {
  const drop = projectBulletDrop(bullets(), [0, 0], [0, 1], 'after');
  assert.deepEqual(texts(apply(bullets(), drop)[0].children), ['a1', 'a0']);
  assert.equal(drop.anchorKey, '0.1');
  assert.equal(drop.label, 'Position 2 of 2 under “a”');
  assert.equal(projectBulletDrop(bullets(), [0, 0], [2, 0], 'before'), null);
  assert.equal(projectBulletDrop(bullets(), [0, 0], [1], 'before'), null);
});

test('drops on itself, inside its own subtree, or that change nothing are rejected', () => {
  assert.equal(projectBulletDrop(bullets(), [0], [0], 'after'), null);
  assert.equal(projectBulletDrop(bullets(), [0], [0, 1], 'before'), null);
  assert.equal(projectBulletDrop(bullets(), [1], [0], 'after'), null);
  assert.equal(projectBulletDrop(bullets(), [1], [2], 'before'), null);
  assert.equal(projectBulletDrop(bullets(), [9], [0], 'before'), null);
});

test('a projection applied after the list changed is clamped or ignored, never thrown', () => {
  const drop = projectBulletDrop(bullets(), [2], [0], 'before');
  const shrunk = bullets().slice(0, 2);
  assert.equal(apply(shrunk, drop), shrunk);
  assert.deepEqual(texts(apply([bullet('x'), bullet('y'), bullet('z'), bullet('w')], drop)), ['z', 'x', 'y', 'w']);
});

test('sub-bullet labels name the parent, shortened, with a fallback for an empty one', () => {
  const long = bullet('x'.repeat(50), [bullet('c0'), bullet('c1')]);
  assert.equal(projectBulletDrop([long], [0, 1], [0, 0], 'before').label, `Position 1 of 2 under “${'x'.repeat(40)}…”`);
  assert.equal(moveBulletBy([bullet('  ', [bullet('c0'), bullet('c1')])], [0, 0], 1).label, 'Position 2 of 2 under “empty bullet”');
});

test('moveBulletBy steps among siblings, labels the move, and stops at the ends', () => {
  const down = moveBulletBy(bullets(), [0], 1);
  assert.deepEqual(texts(down.bullets), ['b', 'a', 'c']);
  assert.deepEqual(down.path, [1]);
  assert.equal(down.label, 'Position 2 of 3');
  const nested = moveBulletBy(bullets(), [0, 1], -1);
  assert.deepEqual(texts(nested.bullets[0].children), ['a1', 'a0']);
  assert.deepEqual(nested.path, [0, 0]);
  assert.equal(nested.label, 'Position 1 of 2 under “a”');
  assert.equal(moveBulletBy(bullets(), [0], -1), null);
  assert.equal(moveBulletBy(bullets(), [2], 1), null);
  assert.equal(moveBulletBy(bullets(), [2, 0], 1), null);
  assert.equal(moveBulletBy(bullets(), [5], 1), null);
});
