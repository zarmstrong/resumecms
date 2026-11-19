import test from 'node:test';
import assert from 'node:assert/strict';
import { customItemDate, patchCustomItem } from './customItems.js';

test('a custom item draws its date as written, trimmed, and nothing for none', () => {
  assert.equal(customItemDate({ heading: 'Paper', date: ' 2021 ' }), '2021');
  assert.equal(customItemDate({ heading: 'Paper', date: 'Forthcoming' }), 'Forthcoming');
  assert.equal(customItemDate({ heading: 'Paper' }), '');
  assert.equal(customItemDate({ date: '   ' }), '');
  assert.equal(customItemDate({ date: 2021 }), '');
  assert.equal(customItemDate(null), '');
});

test('a custom item stores its date only while it is set', () => {
  const item = { heading: 'Paper', bodyType: 'text', text: 'J.' };
  const dated = patchCustomItem(item, { date: '2021' });
  assert.deepEqual(dated, { ...item, date: '2021' });
  assert.deepEqual(patchCustomItem(dated, { text: 'K.' }), { ...item, text: 'K.', date: '2021' });
  const cleared = patchCustomItem(dated, { date: '' });
  assert.deepEqual(cleared, item);
  assert.equal(Object.hasOwn(cleared, 'date'), false);
  assert.equal(Object.hasOwn(patchCustomItem(item, { heading: 'P' }), 'date'), false);
  assert.deepEqual(item, { heading: 'Paper', bodyType: 'text', text: 'J.' });
});
