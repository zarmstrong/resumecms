import test from 'node:test';
import assert from 'node:assert/strict';
import { groupBlocksIntoColumns, makeAlternateByHeadingClassifier } from './blockColumns.js';
import { classifySkillsEducationAuto } from './sidebarPanel.js';

const block = (id, type = 'experience', parentId = null, data = {}) => ({ id, type, parentId, data });
const ids = (arr) => arr.map((b) => b.id);
// The real sidebar/sidebar-right heuristic, so these tests fail if it drifts.
const sidebarClassify = classifySkillsEducationAuto;

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

test('unnested blocks following a heading with no nested children stay in its group (pre-nesting resumes)', () => {
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

test('a top-level block after a heading that has nested children is NOT folded into that section', () => {
  // Editor semantics: dropping on a heading's edge places the block "after
  // the whole section" (blockDrag.js), distinct from nesting it. The Skills
  // rail section must stay a rail section and the custom block must stay out.
  const blocks = [
    block('h1', 'heading'),
    block('skills', 'skills_group', 'h1'),
    block('note', 'custom'),
    block('h2', 'heading'),
    block('exp', 'experience', 'h2'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(secondary), ['h1', 'skills']);
  assert.deepEqual(ids(primary), ['note', 'h2', 'exp']);
});

test('a heading pinned to a column does not drag a following top-level block with it', () => {
  const blocks = [
    block('h1', 'heading', null, { column: 'secondary' }),
    block('skills', 'skills_group', 'h1'),
    block('note', 'custom'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(secondary), ['h1', 'skills']);
  assert.deepEqual(ids(primary), ['note']);
});

test('a summary after a nested section becomes its own group rather than joining the section', () => {
  const blocks = [
    block('h1', 'heading'),
    block('edu', 'education', 'h1'),
    block('summary', 'summary'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(secondary), ['h1', 'edu']);
  assert.deepEqual(ids(primary), ['summary']);
});

test('children whose heading was filtered out render in place, not at the end', () => {
  // public.js drops a hidden heading but keeps its visible children, so the
  // layout sees them mid-array with a parentId nothing matches.
  const blocks = [
    block('h1', 'heading'),
    block('exp', 'experience', 'h1'),
    block('proj1', 'custom', 'hidden-heading'),
    block('proj2', 'custom', 'hidden-heading'),
    block('h2', 'heading'),
    block('edu', 'education', 'h2'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(primary), ['h1', 'exp', 'proj1', 'proj2']);
  assert.deepEqual(ids(secondary), ['h2', 'edu']);
});

test('orphaned children keep their original relative order across multiple missing parents', () => {
  const blocks = [
    block('a', 'experience', 'missing-2'),
    block('b', 'experience', 'missing-1'),
    block('c', 'experience', 'missing-2'),
  ];
  const { primary } = groupBlocksIntoColumns(blocks, sidebarClassify);
  assert.deepEqual(ids(primary), ['a', 'b', 'c']);
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

// ---- split-columns' alternating classifier ---------------------------------

test('alternating classifier is called for every group, including overridden ones, so it stays in sync', () => {
  const blocks = [
    block('h1', 'heading'),
    block('h2', 'heading', null, { column: 'secondary' }),
    block('h3', 'heading'),
  ];
  const seen = [];
  const inner = makeAlternateByHeadingClassifier();
  const alternating = (group, index) => {
    seen.push(group.heading.id);
    return inner(group, index);
  };
  const { primary, secondary } = groupBlocksIntoColumns(blocks, alternating);
  assert.deepEqual(seen, ['h1', 'h2', 'h3']);
  assert.deepEqual(ids(primary), ['h1', 'h3']);
  assert.deepEqual(ids(secondary), ['h2']);
});

test('alternating classifier keeps a leading headless group with the first section', () => {
  const blocks = [block('summary', 'summary'), block('h1', 'heading'), block('h2', 'heading')];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, makeAlternateByHeadingClassifier());
  assert.deepEqual(ids(primary), ['summary', 'h1']);
  assert.deepEqual(ids(secondary), ['h2']);
});

test('alternating classifier keeps a block placed after a nested section in that section\'s column', () => {
  const blocks = [
    block('h1', 'heading'),
    block('exp', 'experience', 'h1'),
    block('h2', 'heading'),
    block('edu', 'education', 'h2'),
    block('note', 'custom'),
    block('h3', 'heading'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, makeAlternateByHeadingClassifier());
  assert.deepEqual(ids(primary), ['h1', 'exp', 'h3']);
  assert.deepEqual(ids(secondary), ['h2', 'edu', 'note']);
});

test('alternating classifier keeps a headless group with a pinned section before it', () => {
  // Projects auto-lands secondary but is pinned primary; the note dropped
  // after it must follow the pin, not the auto slot. Alternation itself is
  // unaffected: Education still flips relative to Projects' auto slot.
  const blocks = [
    block('h1', 'heading'),
    block('exp', 'experience', 'h1'),
    block('h2', 'heading', null, { column: 'primary' }),
    block('proj', 'custom', 'h2'),
    block('note', 'custom'),
    block('h3', 'heading'),
    block('edu', 'education', 'h3'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, makeAlternateByHeadingClassifier());
  assert.deepEqual(ids(primary), ['h1', 'exp', 'h2', 'proj', 'note', 'h3', 'edu']);
  assert.deepEqual(secondary, []);
});

test('alternating classifier keeps a leading summary with a first section pinned secondary', () => {
  const blocks = [block('summary', 'summary'), block('h1', 'heading', null, { column: 'secondary' }), block('h2', 'heading')];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, makeAlternateByHeadingClassifier());
  // The summary has no section before it, so it keeps the auto column.
  assert.deepEqual(ids(primary), ['summary']);
  assert.deepEqual(ids(secondary), ['h1', 'h2']);
});

test('classifyAuto receives the previous group\'s resolved column, pin included', () => {
  const blocks = [
    block('h1', 'heading', null, { column: 'secondary' }),
    block('skills', 'skills_group', 'h1'),
    block('note', 'custom'),
    block('h2', 'heading'),
  ];
  const seen = [];
  groupBlocksIntoColumns(blocks, (group, index, { previousColumn }) => {
    seen.push(previousColumn);
    return 'primary';
  });
  assert.deepEqual(seen, [null, 'secondary', 'primary']);
});

test('hidden placeholders from the public API take part in grouping like any other block', () => {
  // public.js keeps a hidden heading as a content-free placeholder so the
  // published page groups exactly like the editor preview.
  const blocks = [
    block('h1', 'heading'),
    block('exp', 'experience', 'h1'),
    { ...block('h2', 'heading', null, { column: 'secondary' }), hidden: true },
    block('proj', 'custom', 'h2'),
    block('h3', 'heading'),
    block('edu', 'education', 'h3'),
  ];
  const { primary, secondary } = groupBlocksIntoColumns(blocks, makeAlternateByHeadingClassifier());
  assert.deepEqual(ids(primary), ['h1', 'exp', 'h3', 'edu']);
  assert.deepEqual(ids(secondary), ['h2', 'proj']);
});
