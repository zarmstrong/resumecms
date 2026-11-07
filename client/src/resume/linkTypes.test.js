import test from 'node:test';
import assert from 'node:assert/strict';
import { LINK_TYPES, inferLinkType, linkGlyph, followLabelUrl } from './linkTypes.js';

test('email and phone links have their own badges, inferred from the URL too', () => {
  assert.equal(linkGlyph({ type: 'email' }), 'e');
  assert.equal(linkGlyph({ type: 'phone' }), 'p');
  // A Custom mailto link saved before the types existed gets the email badge.
  assert.equal(inferLinkType({ url: 'mailto:jo@example.com' }), 'email');
  assert.equal(inferLinkType({ url: ' TEL:+15555550100' }), 'phone');
  assert.equal(inferLinkType({ type: 'custom', url: 'mailto:jo@example.com' }), 'custom');
  assert.equal(inferLinkType({ url: 'https://github.com/jo' }), 'github');
});

test("each type's default URL is what its default label gives", () => {
  for (const type of LINK_TYPES.filter((t) => t.urlFromLabel)) {
    assert.equal(type.urlFromLabel(type.defaultLabel), type.defaultUrl, type.value);
  }
});

test('an email or phone URL follows its label until it is edited by hand', () => {
  assert.equal(followLabelUrl({ type: 'email', label: '', url: '' }, 'jo@example.com'), 'mailto:jo@example.com');
  assert.equal(followLabelUrl({ type: 'email', label: 'jo@example.co', url: 'mailto:jo@example.co' }, 'jo@example.com'), 'mailto:jo@example.com');
  assert.equal(followLabelUrl({ type: 'phone', label: '555', url: 'tel:555' }, '555 0100'), 'tel:5550100');
  // Cleared, or edited by hand.
  assert.equal(followLabelUrl({ type: 'phone', label: '555', url: 'tel:555' }, ''), '');
  assert.equal(followLabelUrl({ type: 'email', label: 'jo', url: 'mailto:other@example.com' }, 'jo@example.com'), 'mailto:other@example.com');
  // Other types never touch the URL.
  assert.equal(followLabelUrl({ type: 'github', label: '', url: '' }, 'github.com/jo'), undefined);
  assert.equal(followLabelUrl({ type: 'custom', label: '', url: '' }, 'jo@example.com'), undefined);
});
