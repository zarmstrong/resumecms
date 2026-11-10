import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUploadedImage, carryItemKey, uploadSpot } from './landingImages.js';

const ID = 'a'.repeat(64);
const item = (title, text = '') => ({ title, text, url: '' });
const draft = {
  headline: 'Jo',
  photo: 'upload',
  photoImage: { imageId: 'b'.repeat(64), alt: 'Jo at work' },
  sections: [
    { id: 'pic', kind: 'image', title: '', image: null, caption: '' },
    { id: 'list', kind: 'items', title: 'Projects', items: [item('One', 'first'), item('Two', 'second'), item('Three', 'third')] },
  ],
  seo: { title: '', description: '', noindex: false },
};

test('the hero takes the upload only while it still shows an uploaded photo', () => {
  const spot = uploadSpot(draft, { kind: 'photo' });
  // A different image: the old description doesn't describe it.
  assert.deepEqual(applyUploadedImage(draft, spot, ID).photoImage, { imageId: ID, alt: '' });
  // Switched to "No photo" and the headline edited meanwhile: nothing is
  // applied, so neither edit is undone.
  const later = { ...draft, photo: 'none', headline: 'Jo Doe' };
  assert.equal(applyUploadedImage(later, spot, ID), null);
});

test('the share image goes into the current seo, whatever else changed', () => {
  const spot = uploadSpot(draft, { kind: 'seo' });
  const later = { ...draft, headline: 'Changed', seo: { ...draft.seo, title: 'T' } };
  const out = applyUploadedImage(later, spot, ID);
  assert.deepEqual(out.seo, { title: 'T', description: '', noindex: false, image: { imageId: ID, alt: '' } });
  assert.equal(out.headline, 'Changed');
});

test('an image section is found by id, and an upload for a removed one is dropped', () => {
  const spot = uploadSpot(draft, { kind: 'section', sectionId: 'pic' });
  // Moved below the list and its caption edited: still found, edits kept.
  const moved = { ...draft, sections: [draft.sections[1], { ...draft.sections[0], caption: 'Hi' }] };
  const out = applyUploadedImage(moved, spot, ID);
  assert.deepEqual(out.sections[1], { id: 'pic', kind: 'image', title: '', image: { imageId: ID, alt: '' }, caption: 'Hi' });
  assert.equal(out.sections[0], moved.sections[0]);
  // Removed: the section isn't brought back.
  assert.equal(applyUploadedImage({ ...draft, sections: [draft.sections[1]] }, spot, ID), null);
});

test("an item's thumbnail follows its item when it moves or is edited, and is dropped when it's removed", () => {
  const spot = uploadSpot(draft, { kind: 'item', sectionId: 'list', index: 1 });
  const items = (landing) => landing.sections[1].items;
  const withItems = (list) => ({ ...draft, sections: [draft.sections[0], { ...draft.sections[1], items: list }] });
  const [one, two, three] = items(draft);
  const placed = { imageId: ID, alt: '' };

  // Unchanged: lands on "Two".
  assert.deepEqual(items(applyUploadedImage(draft, spot, ID))[1], { ...item('Two', 'second'), image: placed });
  // "Move down": "Two" is now third, and that's where it goes.
  const moved = items(applyUploadedImage(withItems([one, three, two]), spot, ID));
  assert.equal(moved[1].image, undefined);
  assert.deepEqual(moved[2].image, placed);
  // Edited (as the form and an AI accept edit it, passing its key on), even
  // into a copy of another item: still the same item.
  const edited = carryItemKey(two, { ...two, title: 'One', text: 'first' });
  const out = items(applyUploadedImage(withItems([one, edited, three]), spot, ID));
  assert.equal(out[0].image, undefined);
  assert.deepEqual(out[1].image, placed);
  // The item it lands on keeps its key, for the next upload.
  const again = applyUploadedImage(withItems([one, two, three]), spot, ID);
  assert.deepEqual(items(applyUploadedImage(again, spot, 'c'.repeat(64)))[1].image, { imageId: 'c'.repeat(64), alt: '' });
  // Removed: nothing gets it, and nothing else changes.
  assert.equal(applyUploadedImage(withItems([one, three]), spot, ID), null);
  // Its whole section removed.
  assert.equal(applyUploadedImage({ ...draft, sections: [draft.sections[0]] }, spot, ID), null);
  // Replaced by an equal copy nobody passed the key to (a discard, a
  // reload): dropped, never guessed.
  assert.equal(applyUploadedImage(withItems([one, { ...two }, three]), spot, ID), null);
  assert.equal(uploadSpot(draft, { kind: 'item', sectionId: 'list', index: 7 }), null);
  assert.equal(applyUploadedImage(draft, null, ID), null);
});

test('an item no content tells apart is still only the item itself (review round 2)', () => {
  const list = (items) => ({ ...draft, sections: [{ id: 's1', kind: 'items', title: '', items }] });
  // Two fresh empty items; an upload for the second, which is deleted
  // while it runs: the first doesn't get it.
  const a = item('');
  const b = item('');
  const spot = uploadSpot(list([a, b]), { kind: 'item', sectionId: 's1', index: 1 });
  assert.equal(applyUploadedImage(list([a]), spot, ID), null);
  // 'bar' and 'foo'; an upload for 'foo', which is deleted, and a new
  // empty item added in its place: the new one doesn't get it.
  const bar = item('bar');
  const foo = item('foo');
  const fooSpot = uploadSpot(list([bar, foo]), { kind: 'item', sectionId: 's1', index: 1 });
  assert.equal(applyUploadedImage(list([bar, item('')]), fooSpot, ID), null);
  // Untitled items with text: the upload's item deleted, a neighbour
  // sliding into its index doesn't get it either.
  const [x, y, z] = [item('', 'bar'), item('', 'foo'), item('', 'baz')];
  const ySpot = uploadSpot(list([x, y, z]), { kind: 'item', sectionId: 's1', index: 1 });
  assert.equal(applyUploadedImage(list([x, z]), ySpot, ID), null);
  // And with nothing removed, an empty item is found wherever it went.
  const out = applyUploadedImage(list([b, a]), spot, ID);
  assert.deepEqual(out.sections[0].items.map((i) => Boolean(i.image)), [true, false]);
});

test('a replaced image keeps its alt text only when it is the same image again', () => {
  const OLD = 'b'.repeat(64);
  const described = { imageId: OLD, alt: 'Jo at work' };
  const landing = {
    ...draft,
    photoImage: described,
    sections: [
      { id: 'pic', kind: 'image', title: '', image: described, caption: '' },
      { id: 'list', kind: 'items', title: '', items: [{ ...item('One'), image: described }] },
    ],
    seo: { ...draft.seo, image: described },
  };
  const spots = [
    [uploadSpot(landing, { kind: 'photo' }), (l) => l.photoImage],
    [uploadSpot(landing, { kind: 'seo' }), (l) => l.seo.image],
    [uploadSpot(landing, { kind: 'section', sectionId: 'pic' }), (l) => l.sections[0].image],
    [uploadSpot(landing, { kind: 'item', sectionId: 'list', index: 0 }), (l) => l.sections[1].items[0].image],
  ];
  for (const [spot, at] of spots) {
    // A new image: its alt starts empty, so it has to be described again.
    assert.deepEqual(at(applyUploadedImage(landing, spot, ID)), { imageId: ID, alt: '' }, spot.target.kind);
    // The same bytes uploaded again (the same id): the description still fits.
    assert.deepEqual(at(applyUploadedImage(landing, spot, OLD)), described, spot.target.kind);
  }
});

test('several uploads into a gallery each land on their own entry, wherever it went, or nowhere (issue #120)', () => {
  const empty = () => ({ image: null, caption: '' });
  const gallery = (images) => ({ ...draft, sections: [{ id: 'g', kind: 'gallery', title: '', images }] });
  const entries = (landing) => landing.sections[0].images;
  const ids = ['1', '2', '3'].map((c) => c.repeat(64));
  // Three files picked at once: three empty entries no content tells apart,
  // each with an upload of its own.
  const [a, b, c] = [empty(), empty(), empty()];
  const start = gallery([a, b, c]);
  const spots = [0, 1, 2].map((index) => uploadSpot(start, { kind: 'gallery', sectionId: 'g', index }));

  // They resolve out of order, while the entries move and are captioned
  // (the form passes each edited entry's key on).
  let now = gallery([c, carryItemKey(a, { ...a, caption: 'First' }), b]);
  now = applyUploadedImage(now, spots[1], ids[1]);
  now = applyUploadedImage(now, spots[0], ids[0]);
  assert.deepEqual(
    entries(now).map((e) => [e.image?.imageId ?? null, e.caption]),
    [
      [null, ''],
      [ids[0], 'First'],
      [ids[1], ''],
    ]
  );
  // A new image starts with no description.
  assert.equal(entries(now)[1].image.alt, '');
  // The third entry is removed before its upload lands: nothing gets it,
  // not even an empty entry added in its place.
  const removed = gallery([...entries(now).slice(1), empty()]);
  assert.equal(applyUploadedImage(removed, spots[2], ids[2]), null);
  // Nor does a copy nobody passed the key to, or another kind of section.
  assert.equal(applyUploadedImage(gallery([{ ...c }]), spots[2], ids[2]), null);
  assert.equal(applyUploadedImage({ ...draft, sections: [{ id: 'g', kind: 'items', title: '', items: [c] }] }, spots[2], ids[2]), null);
  assert.equal(uploadSpot(start, { kind: 'gallery', sectionId: 'g', index: 3 }), null);
  assert.equal(uploadSpot(start, { kind: 'gallery', sectionId: 'nope', index: 0 }), null);
});
