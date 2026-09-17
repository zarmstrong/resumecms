import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBlocksIntoColumns } from './blockColumns.js';

const block = (id, type = 'experience', parentId = null, data = {}) => ({ id, type, parentId, data });
const ids = (arr) => arr.map((b) => b.id);

// Mirrors the sidebar layout's real heuristic: a heading's section goes to
// the secondary column only if every non-heading child is skills_group or
// education.
const SIDEBAR_AUTO_TYPES = new Set(['skills_group', 'education']);
function sidebarClassify(group) {
  const items = group.blocks.filter((b) => b.type !== 'heading');
  return items.length > 0 && items.every((b) => SIDEBAR_AUTO_TYPES.has(b.type)) ? 'secondary' : 'primary';
}

test('groups a heading with its nested children and classifies by type', () => {
  const blocks = [
    block('h1', 'heading'),
    block('skills', 'skills_group', 'h1'),
    block('h2', 'heading'),
    block('exp', 'experience', 'h2'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(secondary), ['h1', 'skills']);
  assert.deepEqual(ids(primary), ['h2', 'exp']);
});

test('explicit data.column overrides auto-classification', () => {
  const blocks = [
    block('h1', 'heading', null, { column: 'primary' }),
    block('skills', 'skills_group', 'h1'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(primary), ['h1', 'skills']);
  assert.deepEqual(secondary, []);
});

test('an unrecognized column value falls back to auto-classification', () => {
  const blocks = [block('h1', 'heading', null, { column: 'bogus' }), block('skills', 'skills_group', 'h1')];
  const { secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(secondary), ['h1', 'skills']);
});

test('consecutive headless top-level blocks join one group, like unnested content before any heading', () => {
  const blocks = [block('summary', 'summary'), block('skills', 'skills_group')];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(primary), ['summary', 'skills']);
  assert.deepEqual(secondary, []);
});

test('unnested blocks immediately following a heading stay in its group (most resumes predate nesting)', () => {
  const blocks = [
    block('h1', 'heading'),
    block('skills', 'skills_group'),
    block('edu', 'education'),
    block('h2', 'heading'),
    block('exp', 'experience'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(secondary), ['h1', 'skills', 'edu']);
  assert.deepEqual(ids(primary), ['h2', 'exp']);
});

test('a block whose parentId references a missing/non-top-level heading still renders as its own group', () => {
  const blocks = [block('h1', 'heading'), block('orphan', 'experience', 'missing-heading')];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(primary), ['h1', 'orphan']);
  assert.deepEqual(secondary, []);
});

test('a heading with no children still forms a group', () => {
  const blocks = [block('h1', 'heading')];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(primary), ['h1']);
  assert.deepEqual(secondary, []);
});

test('classifyAuto receives the group index for round-robin style layouts', () => {
  const blocks = [block('h1', 'heading'), block('h2', 'heading'), block('h3', 'heading')];
  const roundRobin = (group, index) => (index % 2 === 0 ? 'primary' : 'secondary');
  const { primary, secondary } = groupBlocksIntoColumns(blocks, roundRobin);
  assert.deepEqual(ids(primary), ['h1', 'h3']);
  assert.deepEqual(ids(secondary), ['h2']);
});

test('grouping does not depend on children being positionally adjacent to their heading', () => {
  const blocks = [
    block('h1', 'heading'),
    block('h2', 'heading'),
    block('skills', 'skills_group', 'h1'),
    block('exp', 'experience', 'h2'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(secondary), ['h1', 'skills']);
  assert.deepEqual(ids(primary), ['h2', 'exp']);
});
