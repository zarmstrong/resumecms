import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySectionDrop, liveCollapsedIds, moveSectionBy, placeSection, projectSectionDrop } from './sectionDrag.js';

const list = (...ids) => ids.map((id) => ({ id }));
const ids = (sections) => sections.map((s) => s.id).join('');

test('placeSection moves a section before or after another', () => {
  const sections = list('a', 'b', 'c', 'd');
  assert.equal(ids(placeSection(sections, 'a', 'c', 'after').sections), 'bcad');
  assert.equal(ids(placeSection(sections, 'a', 'c', 'before').sections), 'bacd');
  assert.equal(ids(placeSection(sections, 'd', 'a', 'before').sections), 'dabc');
  assert.equal(ids(placeSection(sections, 'd', 'b', 'after').sections), 'abdc');
  assert.equal(placeSection(sections, 'a', 'c', 'after').index, 2);
});

test('placeSection keeps the section objects as they are', () => {
  const sections = list('a', 'b');
  const next = placeSection(sections, 'a', 'b', 'after').sections;
  assert.equal(next[1], sections[0]);
  assert.equal(next[0], sections[1]);
});

test('placeSection is null for a drop that changes nothing or names a missing section', () => {
  const sections = list('a', 'b', 'c');
  assert.equal(placeSection(sections, 'b', 'b', 'before'), null);
  assert.equal(placeSection(sections, 'b', 'a', 'after'), null);
  assert.equal(placeSection(sections, 'b', 'c', 'before'), null);
  assert.equal(placeSection(sections, 'x', 'a', 'before'), null);
  assert.equal(placeSection(sections, 'a', 'x', 'before'), null);
});

test('projectSectionDrop labels where the section lands', () => {
  const sections = list('a', 'b', 'c');
  assert.deepEqual(projectSectionDrop(sections, 'a', 'c', 'after'), {
    activeId: 'a', anchorId: 'c', edge: 'after', label: 'Position 3 of 3',
  });
  assert.equal(projectSectionDrop(sections, 'c', 'a', 'before').label, 'Position 1 of 3');
  assert.equal(projectSectionDrop(sections, 'a', 'b', 'before'), null);
});

test('applySectionDrop applies by id to the sections as they are at the drop', () => {
  const projection = projectSectionDrop(list('a', 'b', 'c', 'd'), 'a', 'c', 'after');
  // A section removed and another added mid-drag: "after c" still means c.
  const applied = applySectionDrop(list('e', 'a', 'b', 'c'), projection);
  assert.equal(ids(applied.sections), 'ebca');
  assert.equal(applied.label, 'Position 4 of 4');
  // Already there by the time it lands: nothing to save.
  assert.equal(applySectionDrop(list('b', 'c', 'a', 'e'), projection), null);
  // Its anchor removed: nothing moves.
  assert.equal(applySectionDrop(list('a', 'b', 'd'), projection), null);
  assert.equal(applySectionDrop(list('a', 'b'), null), null);
});

test('moveSectionBy shifts one place and stops at the ends', () => {
  const sections = list('a', 'b', 'c');
  const down = moveSectionBy(sections, 'a', 1);
  assert.equal(ids(down.sections), 'bac');
  assert.equal(down.label, 'Position 2 of 3');
  assert.equal(ids(moveSectionBy(sections, 'c', -1).sections), 'acb');
  assert.equal(moveSectionBy(sections, 'a', -1), null);
  assert.equal(moveSectionBy(sections, 'c', 1), null);
  assert.equal(moveSectionBy(sections, 'x', 1), null);
});

test('liveCollapsedIds keeps only sections still in the draft, in their order', () => {
  assert.deepEqual(liveCollapsedIds(new Set(['c', 'gone', 'a']), list('a', 'b', 'c')), ['a', 'c']);
});
