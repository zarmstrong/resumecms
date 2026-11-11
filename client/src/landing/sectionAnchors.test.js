import test from 'node:test';
import assert from 'node:assert/strict';
import { ANCHOR_PREFIX, anchorFromHash, currentAnchor, scrollParent, slugify, withAnchors } from './sectionAnchors.js';

const text = (title, extra = {}) => ({ kind: 'text', title, body: 'x', ...extra });

test('a title slugs to lowercase letters and digits joined by single hyphens', () => {
  assert.equal(slugify('Teaching & Service'), 'teaching-service');
  assert.equal(slugify('  Selected Publications (2019–2024) '), 'selected-publications-2019-2024');
  assert.equal(slugify('Café Résumé'), 'cafe-resume');
  assert.equal(slugify('Über uns'), 'uber-uns');
  // Other scripts stay letters rather than vanishing.
  assert.equal(slugify('Публикации'), 'публикации');
  assert.equal(slugify('研究'), '研究');
  // Nothing left: still an anchor.
  assert.equal(slugify('🎓 ✨'), 'section');
  assert.equal(slugify(''), 'section');
  // Capped, and never ending in a hyphen after the cut.
  const long = slugify(`${'a'.repeat(59)} b c`);
  assert.equal(long, 'a'.repeat(59));
  assert.ok(slugify('word '.repeat(40)).length <= 60);
});

test('every titled section gets a unique anchor, numbered on a repeat', () => {
  const { sections, entries } = withAnchors([text('Talks'), text('Talks'), text('Talks 2'), text('talks!')]);
  assert.deepEqual(
    sections.map((s) => s.anchor),
    ['section-talks', 'section-talks-2', 'section-talks-2-2', 'section-talks-3']
  );
  assert.equal(new Set(entries.map((e) => e.anchor)).size, 4);
  assert.deepEqual(
    entries.map((e) => e.title),
    ['Talks', 'Talks', 'Talks 2', 'talks!']
  );
});

test('untitled sections, dividers, hidden and stray ones get no entry and no anchor', () => {
  const input = [
    text(''),
    text('   '),
    { kind: 'divider', title: 'Part two' },
    text('Hidden', { hidden: true }),
    { kind: 'divider', title: 'Stray', stray: true },
    { kind: 'stats', stats: [] },
    text(' About '),
  ];
  const { sections, entries } = withAnchors(input);
  assert.deepEqual(entries, [{ anchor: 'section-about', title: 'About' }]);
  assert.deepEqual(
    sections.map((s) => s.anchor),
    [undefined, undefined, undefined, undefined, undefined, undefined, 'section-about']
  );
  // The input isn't changed, and a section without an entry is passed on as is.
  assert.equal(input[6].anchor, undefined);
  assert.equal(sections[0], input[0]);
});

test("a hidden section doesn't change the anchors after it, so the preview's match the page's", () => {
  const page = withAnchors([text('Talks'), text('Talks')]);
  const preview = withAnchors([text('Talks', { hidden: true }), text('Talks'), text('Talks')]);
  assert.deepEqual(preview.entries, page.entries);
});

test('every anchor starts with the prefix, so none can be another id on the page', () => {
  for (const title of ['root', 'main', 'toc', '1', '---']) {
    const [entry] = withAnchors([text(title)]).entries;
    assert.ok(entry.anchor.startsWith(ANCHOR_PREFIX), entry.anchor);
  }
  assert.equal(withAnchors([text('About')], { prefix: 'p1-section-' }).entries[0].anchor, 'p1-section-about');
});

test('the hash a page opens at names an entry, or nothing', () => {
  const { entries } = withAnchors([text('Talks'), text('Публикации')]);
  assert.equal(anchorFromHash('#section-talks', entries), 'section-talks');
  assert.equal(anchorFromHash(`#${encodeURIComponent('section-публикации')}`, entries), 'section-публикации');
  assert.equal(anchorFromHash('#section-books', entries), null);
  assert.equal(anchorFromHash('#%E0%A4%A', entries), null);
  assert.equal(anchorFromHash('', entries), null);
  assert.equal(anchorFromHash(undefined, entries), null);
});

test('the current entry is the one jumped to, the last at the end, else the last one begun', () => {
  const { entries } = withAnchors([text('A'), text('B'), text('C')]);
  const tops = (map) => (anchor) => map[anchor];
  // A has scrolled past and B has begun above the line: B is being read.
  const midway = tops({ 'section-a': -900, 'section-b': 40, 'section-c': 700 });
  assert.equal(currentAnchor(entries, midway, { line: 120 }), 'section-b');
  // Still B, however far its top has gone up.
  assert.equal(currentAnchor(entries, tops({ 'section-a': -3000, 'section-b': -2000, 'section-c': 500 }), { line: 120 }), 'section-b');
  // At the top, under the hero: none yet.
  assert.equal(currentAnchor(entries, tops({ 'section-a': 400, 'section-b': 900, 'section-c': 1400 }), { line: 120 }), null);
  // A section not on the page (the preview's draft changed) doesn't count.
  assert.equal(currentAnchor(entries, tops({ 'section-a': -10 }), { line: 120 }), 'section-a');
  assert.equal(currentAnchor(entries, midway, { line: 120, atEnd: true }), 'section-c');
  assert.equal(currentAnchor([], midway, { atEnd: true }), null);
  // The one just jumped to stays current, at the end too, while it's there.
  assert.equal(currentAnchor(entries, midway, { line: 120, atEnd: true, pinned: 'section-a' }), 'section-a');
  assert.equal(currentAnchor(entries, midway, { line: 120, pinned: 'section-gone' }), 'section-b');
});

test('the scroll parent is the nearest ancestor that scrolls, or the window', () => {
  const node = (overflowY, parentElement = null) => ({ overflowY, parentElement });
  const html = node('visible');
  const body = node('visible', html);
  const pane = node('auto', body);
  const frame = node('visible', pane);
  const nav = node('visible', frame);
  const styleOf = (n) => ({ overflowY: n.overflowY });
  assert.equal(scrollParent(nav, styleOf), pane);
  assert.equal(scrollParent(node('visible', body), styleOf), null);
  // <html> scrolls the window, whatever its style says.
  assert.equal(scrollParent(node('visible', node('scroll')), styleOf), null);
  assert.equal(scrollParent(null, styleOf), null);
});
