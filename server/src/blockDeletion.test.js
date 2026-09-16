import test from 'node:test';
import assert from 'node:assert/strict';
import { promotedBlockPositions } from './blockDeletion.js';

const block = (id, parentId = null, position = 0) => ({ id, parentId, position });

test('promotes children at the deleted heading location, retaining later sections', () => {
  const blocks = [block('intro'), block('heading', null, 1), block('a', 'heading'),
    block('b', 'heading', 1), block('next', null, 2), block('nested', 'next'), block('end', null, 3)];
  const snapshot = structuredClone(blocks);
  const updates = promotedBlockPositions(blocks, 'heading');
  assert.deepEqual(updates, [
    { id: 'intro', position: 0 }, { id: 'a', position: 1 },
    { id: 'b', position: 2 }, { id: 'next', position: 3 }, { id: 'end', position: 4 },
  ]);
  assert.deepEqual(blocks, snapshot);
  assert.ok(!updates.some((b) => b.id === 'nested'));
});

test('handles headings at the beginning and end without reversing child order', () => {
  for (const [blocks, expected] of [
    [[block('heading'), block('a', 'heading'), block('b', 'heading', 1), block('end')], ['a', 'b', 'end']],
    [[block('intro'), block('heading'), block('a', 'heading'), block('b', 'heading', 1)], ['intro', 'a', 'b']],
  ]) {
    assert.deepEqual(promotedBlockPositions(blocks, 'heading'), expected.map((id, position) => ({ id, position })));
  }
});

test('leaves unrelated nested and orphaned blocks out of top-level updates', () => {
  const blocks = [block('heading'), block('a', 'heading'), block('other'),
    block('nested', 'other'), block('orphan', 'missing'), block('empty', '')];
  assert.deepEqual(promotedBlockPositions(blocks, 'heading'), [
    { id: 'a', position: 0 }, { id: 'other', position: 1 },
  ]);
});
