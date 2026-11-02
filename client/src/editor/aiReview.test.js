import test from 'node:test';
import assert from 'node:assert/strict';
import { bulletChange, changedFields, isProposalStale, wordDiff } from './aiReview.js';

const join = (runs, keep) => runs.filter((r) => keep.includes(r.type)).map((r) => r.text).join('');

test('wordDiff reproduces both sides exactly', () => {
  const before = 'Led a team of five engineers.';
  const after = 'Led a team of eight engineers to ship v2.';
  const runs = wordDiff(before, after);
  assert.equal(join(runs, ['same', 'del']), before);
  assert.equal(join(runs, ['same', 'add']), after);
  assert.ok(runs.some((r) => r.type === 'del' && r.text.includes('five')));
  assert.ok(runs.some((r) => r.type === 'add' && r.text.includes('eight')));
});

test('wordDiff groups a fully rewritten phrase instead of interleaving it', () => {
  const runs = wordDiff('A short description of what the company does.', 'Builds developer tooling for Example Corp.');
  assert.deepEqual(runs.map((r) => r.type), ['del', 'add']);
});

test('wordDiff merges adjacent runs and handles empty sides', () => {
  assert.deepEqual(wordDiff('', 'new text'), [{ type: 'add', text: 'new text' }]);
  assert.deepEqual(wordDiff('old text', ''), [{ type: 'del', text: 'old text' }]);
  assert.deepEqual(wordDiff('same', 'same'), [{ type: 'same', text: 'same' }]);
});

test('changedFields lists only fields that changed', () => {
  const fields = changedFields('skills_group', { category: 'Tools', items: 'a, b' }, { category: 'Tools', items: 'A, B' });
  assert.deepEqual(fields, [{ label: 'Items', before: 'a, b', after: 'A, B' }]);
});

test('changedFields reads each custom item from its body-type field', () => {
  const before = { title: 'T', items: [{ heading: 'h', bodyType: 'link', label: 'View', url: 'u' }] };
  const after = { title: 'T', items: [{ heading: 'h', bodyType: 'link', label: 'See it', url: 'u' }] };
  assert.deepEqual(changedFields('custom', before, after), [{ label: 'Item 1', before: 'View', after: 'See it' }]);
});

test('bulletChange labels added, reworded, and unchanged bullets', () => {
  assert.equal(bulletChange({ before: null, after: 'x' }), 'added');
  assert.equal(bulletChange({ before: 'x', after: 'y' }), 'reworded');
  assert.equal(bulletChange({ before: 'x', after: 'x' }), 'unchanged');
});

test('isProposalStale detects edits made after the proposal', () => {
  const proposal = { baseData: { text: 'a' } };
  assert.equal(isProposalStale(proposal, { text: 'a' }), false);
  assert.equal(isProposalStale(proposal, { text: 'ab' }), true);
});
