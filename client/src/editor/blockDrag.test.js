import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlockReorderItems, pointerPlacement, projectBlockDrop } from './blockDrag.js';

const block = (id, type = 'experience', parentId = null) => ({ id, type, parentId, data: { text: id } });
const h = block('h', 'heading');
const a = block('a');
const b = block('b');
const c = block('c', 'experience', 'h');
const ids = (projection) => projection.ordered.map((b) => b.id);

test('reordering another block clears invalid parents and preserves valid nesting', () => {
  const blocks = [h, c, a, b,
    block('missing', 'experience', 'deleted-heading'),
    block('non-heading', 'custom', 'a'),
    block('bad-heading', 'heading', 'h'),
    block('bad-child', 'education', 'bad-heading'),
    block('summary', 'summary', 'h'),
    block('unknown', 'unknown', 'h'),
    block('empty', 'skills_group', ''),
    block('malformed', 'custom', {}),
  ];
  const snapshot = structuredClone(blocks);
  const { ordered } = projectBlockDrop(blocks, 'b', 'a', 'before');
  const items = createBlockReorderItems(ordered, blocks);
  assert.deepEqual(items.map((b) => b.id), ['h', 'c', 'b', 'a', ...blocks.slice(4).map((b) => b.id)]);
  assert.deepEqual(items.filter((b) => b.parentId !== null), [{ id: 'c', parentId: 'h' }]);
  assert.deepEqual(blocks, snapshot);
});

test('reorder payload retains newly requested nesting for every supported type', () => {
  for (const type of ['experience', 'education', 'skills_group', 'custom']) {
    const blocks = [h, block('entry', type)];
    const { ordered } = projectBlockDrop(blocks, 'entry', 'h', 'inside');
    assert.deepEqual(createBlockReorderItems(ordered, blocks), [
      { id: 'h', parentId: null }, { id: 'entry', parentId: 'h' },
    ]);
  }
});

test('repairing a malformed heading also clears its children for pre-update API validation', () => {
  const blocks = [h, block('bad-heading', 'heading', 'h'), block('child', 'custom', 'bad-heading'), a];
  const { ordered } = projectBlockDrop(blocks, 'bad-heading', 'a', 'after');
  assert.equal(ordered.find((b) => b.id === 'bad-heading').parentId, null);
  assert.ok(createBlockReorderItems(ordered, blocks).every((b) => b.parentId === null));
});

test('dropping onto a heading nests from either direction, including an adjacent row', () => {
  for (const blocks of [[a, h, c], [h, a, c], [h, c, a]]) {
    const drop = projectBlockDrop(blocks, 'a', 'h', 'inside');
    assert.deepEqual(ids(drop), ['h', 'a', 'c']);
    assert.equal(drop.ordered[1].parentId, 'h');
    assert.equal(drop.headingId, 'h');
    assert.match(drop.label, /Nest under/);
  }
});

test('inserting among children adopts the section without reparenting other blocks', () => {
  const drop = projectBlockDrop([h, c, a, b], 'a', 'c', 'after');
  assert.deepEqual(ids(drop), ['h', 'c', 'a', 'b']);
  assert.equal(drop.ordered[2].parentId, 'h');
  assert.equal(drop.ordered[3], b);
});

test('left-edge drops unnest above or below the entire section', () => {
  const sibling = block('s', 'custom', 'h');
  const blocks = [h, c, sibling, a];
  const before = projectBlockDrop(blocks, 'c', 's', 'before', true);
  assert.deepEqual(ids(before), ['c', 'h', 's', 'a']);
  assert.equal(before.ordered[0].parentId, null);
  const after = projectBlockDrop(blocks, 'c', 's', 'after', true);
  assert.deepEqual(ids(after), ['h', 's', 'c', 'a']);
  assert.equal(after.ordered[2].parentId, null);
});

test('a same-row horizontal drop can unnest without changing display order', () => {
  const drop = projectBlockDrop([h, c, a], 'c', 'c', 'after', true);
  assert.deepEqual(ids(drop), ['h', 'c', 'a']);
  assert.equal(drop.ordered[1].parentId, null);
});

test('headings move with their children and cannot drop into their own section', () => {
  const drop = projectBlockDrop([h, c, a, b], 'h', 'b', 'after');
  assert.deepEqual(ids(drop), ['a', 'b', 'h', 'c']);
  assert.equal(drop.ordered[3], c);
  assert.equal(projectBlockDrop([h, c, a], 'h', 'c', 'before'), null);
});

test('top-level drops do not split sections', () => {
  const drop = projectBlockDrop([h, c, a], 'a', 'h', 'after');
  assert.deepEqual(ids(drop), ['h', 'c', 'a']);
  assert.equal(drop.parentId, null);
  assert.equal(drop.anchorId, 'c');
  assert.equal(drop.edge, 'after');
});

test('summaries, headings, unknown types, and invalid parents cannot nest', () => {
  for (const type of ['summary', 'heading', 'unknown']) {
    assert.equal(projectBlockDrop([h, block('x', type)], 'x', 'h', 'inside'), null);
  }
  const orphan = block('orphan', 'experience', 'missing');
  assert.equal(projectBlockDrop([orphan, a], 'a', 'orphan', 'after').parentId, null);
  assert.equal(projectBlockDrop([block('bad', 'heading', 'missing'), a], 'a', 'bad', 'inside'), null);
  assert.equal(projectBlockDrop([h, a], 'missing', 'h', 'inside'), null);
});

test('heading center is a broad nesting target; edges specify ordering', () => {
  const rect = { top: 100, height: 80 };
  assert.equal(pointerPlacement(h, rect, { y: 110 }), 'before');
  assert.equal(pointerPlacement(h, rect, { y: 140 }), 'inside');
  assert.equal(pointerPlacement(h, rect, { y: 170 }), 'after');
});
