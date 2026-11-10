import test from 'node:test';
import assert from 'node:assert/strict';
import { galleryAnnouncement, galleryStep } from './gallery.js';

test('the arrow keys move through the gallery, wrapping around; Home and End go to either end', () => {
  assert.equal(galleryStep(0, 3, 'ArrowRight'), 1);
  assert.equal(galleryStep(2, 3, 'ArrowRight'), 0);
  assert.equal(galleryStep(0, 3, 'ArrowLeft'), 2);
  assert.equal(galleryStep(2, 3, 'ArrowLeft'), 1);
  assert.equal(galleryStep(1, 3, 'Home'), 0);
  assert.equal(galleryStep(1, 3, 'End'), 2);
  assert.equal(galleryStep(0, 1, 'ArrowRight'), 0);
  // Anything else is left to the dialog and the browser.
  for (const key of ['Escape', 'Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'a']) assert.equal(galleryStep(1, 3, key), null, key);
  assert.equal(galleryStep(0, 0, 'ArrowRight'), null);
});

test("the view announces the image's place and description", () => {
  assert.equal(galleryAnnouncement(1, 5, 'A wedding cake '), 'Image 2 of 5: A wedding cake');
  assert.equal(galleryAnnouncement(0, 1, ' '), 'Image 1 of 1');
  assert.equal(galleryAnnouncement(0, 2, undefined), 'Image 1 of 2');
});
