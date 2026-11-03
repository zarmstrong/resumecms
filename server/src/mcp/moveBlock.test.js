import test from 'node:test';
import assert from 'node:assert/strict';
import { moveBlockOrder } from './moveBlock.js';
import { findSplitSectionId } from '../blockReorder.js';

const blk = (id, type, parentId = null) => ({ id, type, parentId });
// summary, heading h1 [a, b], heading h2 [c], education e
const base = () => [
  blk('s', 'summary'),
  blk('h1', 'heading'),
  blk('a', 'experience', 'h1'),
  blk('b', 'experience', 'h1'),
  blk('h2', 'heading'),
  blk('c', 'experience', 'h2'),
  blk('e', 'education'),
];
const flat = (items) => items.map((i) => (i.parentId ? `${i.parentId}/${i.id}` : i.id));

function check(items) {
  assert.equal(findSplitSectionId(items), null, 'sections must stay contiguous');
  return flat(items);
}

test('no anchor moves to the end of the current group', () => {
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'a' })), ['s', 'h1', 'h1/b', 'h1/a', 'h2', 'h2/c', 'e']);
  assert.deepEqual(check(moveBlockOrder(base(), { id: 's' })), ['h1', 'h1/a', 'h1/b', 'h2', 'h2/c', 'e', 's']);
});

test('beforeId / afterId / index place within the target group', () => {
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'b', beforeId: 'a' })), ['s', 'h1', 'h1/b', 'h1/a', 'h2', 'h2/c', 'e']);
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'e', afterId: 's' })), ['s', 'e', 'h1', 'h1/a', 'h1/b', 'h2', 'h2/c']);
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'e', index: 0 })), ['e', 's', 'h1', 'h1/a', 'h1/b', 'h2', 'h2/c']);
  assert.deepEqual(check(moveBlockOrder(base(), { id: 's', index: 99 })), ['h1', 'h1/a', 'h1/b', 'h2', 'h2/c', 'e', 's']);
});

test('parentId null promotes, a heading id nests, undefined keeps the parent', () => {
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'a', parentId: null })), ['s', 'h1', 'h1/b', 'h2', 'h2/c', 'e', 'a']);
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'a', parentId: null, afterId: 's' })), ['s', 'a', 'h1', 'h1/b', 'h2', 'h2/c', 'e']);
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'e', parentId: 'h2', beforeId: 'c' })), ['s', 'h1', 'h1/a', 'h1/b', 'h2', 'h2/e', 'h2/c']);
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'a', parentId: 'h2' })), ['s', 'h1', 'h1/b', 'h2', 'h2/c', 'h2/a', 'e']);
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'a', index: 1 })), ['s', 'h1', 'h1/b', 'h1/a', 'h2', 'h2/c', 'e']);
});

test('a heading moves with its children', () => {
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'h1', afterId: 'h2' })), ['s', 'h2', 'h2/c', 'h1', 'h1/a', 'h1/b', 'e']);
  assert.deepEqual(check(moveBlockOrder(base(), { id: 'h2', index: 0 })), ['h2', 'h2/c', 's', 'h1', 'h1/a', 'h1/b', 'e']);
  // a heading nested under a heading that currently has no children
  const withEmpty = [...base(), blk('h3', 'heading')];
  assert.deepEqual(check(moveBlockOrder(withEmpty, { id: 'c', parentId: 'h3' })), ['s', 'h1', 'h1/a', 'h1/b', 'h2', 'e', 'h3', 'h3/c']);
});

test('rejects bad requests with a 400/404 status', () => {
  const fail = (args, status, re) => assert.throws(() => moveBlockOrder(base(), args), (e) => e.status === status && re.test(e.message));
  fail({ id: 'zzz' }, 404, /not found/);
  fail({ id: 'a', beforeId: 'b', afterId: 'b' }, 400, /at most one/);
  fail({ id: 'a', beforeId: 'b', index: 0 }, 400, /at most one/);
  fail({ id: 'a', beforeId: 'c' }, 400, /not a sibling/);
  fail({ id: 'a', parentId: 'h2', afterId: 'b' }, 400, /not a sibling/);
  fail({ id: 'a', afterId: 'a' }, 400, /relative to itself/);
  fail({ id: 'a', index: -1 }, 400, /non-negative integer/);
  fail({ id: 'a', index: 1.5 }, 400, /non-negative integer/);
  fail({ id: 'h1', parentId: 'h2' }, 400, /heading blocks can't be nested/);
  fail({ id: 'h1', parentId: 'h1' }, 400, /under itself/);
  fail({ id: 'a', parentId: 'ghost' }, 400, /does not reference an existing block/);
});

test('output lists every block exactly once', () => {
  for (const args of [{ id: 'a' }, { id: 'h1', index: 0 }, { id: 'e', parentId: 'h1', index: 0 }, { id: 'c', parentId: null }]) {
    const items = moveBlockOrder(base(), args);
    assert.deepEqual([...new Set(items.map((i) => i.id))].sort(), ['a', 'b', 'c', 'e', 'h1', 'h2', 's']);
    assert.equal(items.length, 7);
  }
});
