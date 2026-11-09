import test from 'node:test';
import assert from 'node:assert/strict';
import { applyUploadedImage, uploadSpot } from './landingImages.js';

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

test('the hero takes the upload only while it still shows an uploaded photo, keeping its alt', () => {
  const spot = uploadSpot(draft, { kind: 'photo' });
  assert.deepEqual(applyUploadedImage(draft, spot, ID).photoImage, { imageId: ID, alt: 'Jo at work' });
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

test("an item's thumbnail follows its item when it moves, and is dropped when it's removed", () => {
  const spot = uploadSpot(draft, { kind: 'item', sectionId: 'list', index: 1 });
  const items = (landing) => landing.sections[1].items;
  const withItems = (list) => ({ ...draft, sections: [draft.sections[0], { ...draft.sections[1], items: list }] });

  // Unchanged: lands on "Two".
  assert.deepEqual(items(applyUploadedImage(draft, spot, ID))[1], { ...item('Two', 'second'), image: { imageId: ID, alt: '' } });
  // "Move down": "Two" is now third, and that's where it goes.
  const [one, two, three] = items(draft);
  const moved = items(applyUploadedImage(withItems([one, three, two]), spot, ID));
  assert.equal(moved[1].image, undefined);
  assert.deepEqual(moved[2].image, { imageId: ID, alt: '' });
  // Edited in place: still the same item.
  assert.ok(items(applyUploadedImage(withItems([one, { ...two, text: 'second, edited' }, three]), spot, ID))[1].image);
  // Removed: nothing gets it, and nothing else changes.
  assert.equal(applyUploadedImage(withItems([one, three]), spot, ID), null);
  // Its whole section removed.
  assert.equal(applyUploadedImage({ ...draft, sections: [draft.sections[0]] }, spot, ID), null);
});
