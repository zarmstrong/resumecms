import test from 'node:test';
import assert from 'node:assert/strict';
import { findSplitSectionId } from './blockReorder.js';

const item = (id, parentId = null) => ({ id, parentId });

test('accepts a contiguous section directly after its heading', () => {
  const items = [item('intro'), item('heading'), item('a', 'heading'), item('b', 'heading'), item('end')];
  assert.equal(findSplitSectionId(items), null);
});

test('accepts multiple contiguous sections back to back', () => {
  const items = [item('h1'), item('a', 'h1'), item('h2'), item('b', 'h2'), item('c', 'h2')];
  assert.equal(findSplitSectionId(items), null);
});

test('accepts an empty items array and a heading with no children', () => {
  assert.equal(findSplitSectionId([]), null);
  assert.equal(findSplitSectionId([item('heading'), item('end')]), null);
});

test('rejects a section split by a top-level block in between', () => {
  const items = [item('heading'), item('a', 'heading'), item('interloper'), item('b', 'heading')];
  assert.equal(findSplitSectionId(items), 'b');
});

test('rejects a section split by another section', () => {
  const items = [item('h1'), item('a', 'h1'), item('h2'), item('b', 'h2'), item('c', 'h1')];
  assert.equal(findSplitSectionId(items), 'c');
});

test('rejects a child appearing before its heading', () => {
  const items = [item('a', 'heading'), item('heading')];
  assert.equal(findSplitSectionId(items), 'a');
});

test('rejects a child not immediately after its heading', () => {
  const items = [item('heading'), item('other'), item('a', 'heading')];
  assert.equal(findSplitSectionId(items), 'a');
});
