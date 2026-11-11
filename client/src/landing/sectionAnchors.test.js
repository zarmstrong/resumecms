import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANCHOR_PREFIX,
  anchorFromHash,
  anchorTitleId,
  createJumpPin,
  currentAnchor,
  isPlainClick,
  scrollParent,
  slugify,
  withAnchors,
} from './sectionAnchors.js';

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
  // Cut by code points: a letter outside the BMP is never split in half.
  const astral = slugify(`a${'\u{20000}'.repeat(80)}`);
  assert.equal(Array.from(astral).length, 60);
  assert.equal(astral, `a${'\u{20000}'.repeat(59)}`);
  assert.ok(astral.isWellFormed());
  // Never two hyphens in a row, so a heading's id can't be an anchor.
  for (const title of ['a -- b', 'a—–b', '-x-', 'x  - - y']) assert.ok(!slugify(title).includes('--'), title);
});

test("an anchored section's heading id is never another section's anchor", () => {
  const { entries } = withAnchors([text('Talks'), text('Talks title'), text('Talks--title'), text('Talks - title')]);
  const anchors = new Set(entries.map((e) => e.anchor));
  for (const entry of entries) assert.ok(!anchors.has(anchorTitleId(entry.anchor)), entry.anchor);
  assert.equal(anchorTitleId('section-talks'), 'section-talks--title');
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
  // A box that clips it (a thumbnail's frame) is where it stops, not the
  // scrolling pane around that box.
  for (const overflowY of ['hidden', 'clip']) {
    const box = node(overflowY, pane);
    assert.equal(scrollParent(node('visible', node('visible', box)), styleOf), box, overflowY);
  }
});

test('only a plain primary click is a jump; the rest are the browser’s', () => {
  const click = (extra = {}) => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...extra });
  assert.equal(isPlainClick(click()), true);
  for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }, { defaultPrevented: true }]) {
    assert.equal(isPlainClick(click(extra)), false, JSON.stringify(extra));
  }
});

test("a jump's hold lasts through its own scroll and ends at the next one after it settles", () => {
  const pin = createJumpPin(150);
  assert.equal(pin.anchor, null);
  assert.equal(pin.scrolled(0), false);
  pin.set('section-a', 1000);
  // A smooth scroll: an event every frame keeps it.
  for (let t = 1016; t < 1600; t += 16) assert.equal(pin.scrolled(t), false);
  assert.equal(pin.anchor, 'section-a');
  // Quiet, then a scrollbar drag or find-in-page: released.
  assert.equal(pin.scrolled(2000), true);
  assert.equal(pin.anchor, null);
  assert.equal(pin.scrolled(2010), false);
  // A jump that didn't need to scroll: the first later scroll releases it.
  pin.set('section-b', 3000);
  assert.equal(pin.scrolled(3400), true);
  // A wheel, touch, key or press releases it at once.
  pin.set('section-c', 4000);
  assert.equal(pin.release(), true);
  assert.equal(pin.release(), false);
});
