import test from 'node:test';
import assert from 'node:assert/strict';
import { dropStrayDividers } from './dividers.js';

const text = (title) => ({ kind: 'text', title, body: 'x' });
const divider = (title) => ({ kind: 'divider', title });
const titles = (sections) => sections.map((s) => `${s.kind === 'divider' ? '—' : ''}${s.title}${s.stray ? '?' : ''}`);

test('a divider is drawn only between two things it divides', () => {
  const sections = [divider('top'), text('A'), divider('d1'), divider('d2'), text('B'), divider('end'), divider('end2')];
  assert.deepEqual(titles(dropStrayDividers(sections)), ['—top', 'A', '—d1', 'B']);
  // With nothing above the list (split's right column), the first goes too.
  assert.deepEqual(titles(dropStrayDividers(sections, { atStart: false })), ['A', '—d1', 'B']);
  assert.deepEqual(dropStrayDividers([divider('alone')]), []);
  assert.deepEqual(dropStrayDividers([]), []);
});

test("a hidden section doesn't count, and the preview marks a stray divider instead of dropping it", () => {
  const hidden = { ...text('H'), hidden: true };
  const sections = [text('A'), divider('d1'), hidden, divider('d2'), text('B'), divider('d3'), { ...hidden, title: 'H2' }];
  assert.deepEqual(titles(dropStrayDividers(sections)), ['A', '—d1', 'H', 'B', 'H2']);
  assert.deepEqual(titles(dropStrayDividers(sections, { preview: true })), ['A', '—d1', 'H', '—d2?', 'B', '—d3?', 'H2']);
  // A hidden divider is the preview's to dim already; it's never marked.
  const hiddenDivider = { ...divider('hd'), hidden: true };
  assert.deepEqual(titles(dropStrayDividers([text('A'), hiddenDivider, text('B')], { preview: true })), ['A', '—hd', 'B']);
});
