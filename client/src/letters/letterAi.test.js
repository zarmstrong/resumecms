import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyLetterProposal,
  isLetterProposalStale,
  letterBodyEmpty,
  letterChanges,
  letterProposalKey,
  previewLetterData,
  previewedLetterProposals,
  relocateParagraph,
} from './letterAi.js';

const data = { salutation: 'Dear Hiring Manager,', paragraphs: ['A', 'B', 'C'], closing: 'Sincerely,', company: 'Acme' };

const paragraphProposal = (index, text, base = data) => ({
  letterId: 'l1',
  target: { kind: 'paragraph', index },
  baseData: base,
  proposedData: { ...base, paragraphs: base.paragraphs.map((p, i) => (i === index ? text : p)) },
});

const letterProposal = (base = data) => ({
  letterId: 'l1',
  target: { kind: 'letter' },
  baseData: base,
  proposedData: { ...base, salutation: 'Dear Jane,', paragraphs: ['New one', 'New two'], closing: 'Best,' },
});

test('keys and an empty body', () => {
  assert.equal(letterProposalKey('l1', { kind: 'paragraph', index: 2 }), 'l1:paragraph:2');
  assert.equal(letterProposalKey('l1', undefined), 'l1:letter');
  assert.equal(letterBodyEmpty({ paragraphs: ['', '  '] }), true);
  assert.equal(letterBodyEmpty({}), true);
  assert.equal(letterBodyEmpty(data), false);
});

test('applyLetterProposal writes only the target onto the current data', () => {
  const edited = { ...data, company: 'Acme Inc', paragraphs: ['A', 'B edited', 'C'] };
  assert.deepEqual(applyLetterProposal(edited, paragraphProposal(0, 'A better')).paragraphs, ['A better', 'B edited', 'C']);
  const whole = applyLetterProposal(edited, letterProposal());
  assert.deepEqual(whole, { ...edited, salutation: 'Dear Jane,', paragraphs: ['New one', 'New two'], closing: 'Best,' });
  // A paragraph that's gone leaves the letter alone.
  const short = { ...data, paragraphs: ['A'] };
  assert.equal(applyLetterProposal(short, paragraphProposal(2, 'C better')), short);
});

test('staleness compares only the target', () => {
  const p = paragraphProposal(1, 'B better');
  assert.equal(isLetterProposalStale(p, { ...data, closing: 'Best,', paragraphs: ['A edited', 'B', 'C'] }), false);
  assert.equal(isLetterProposalStale(p, { ...data, paragraphs: ['A', 'B edited', 'C'] }), true);
  assert.equal(isLetterProposalStale(letterProposal(), { ...data, company: 'Other' }), false);
  assert.equal(isLetterProposalStale(letterProposal(), { ...data, closing: 'Best,' }), true);
});

test('the preview shows a whole-letter proposal over any paragraph ones, and skips stale paragraphs', () => {
  const p0 = paragraphProposal(0, 'A better');
  const p1 = paragraphProposal(1, 'B better');
  const whole = letterProposal();
  assert.deepEqual(previewedLetterProposals(data, [p0, whole, p1]), [whole]);
  const edited = { ...data, paragraphs: ['A', 'B edited', 'C'] };
  assert.deepEqual(previewedLetterProposals(edited, [p0, p1]), [p0]);
  assert.deepEqual(previewLetterData(edited, [p0, p1]).paragraphs, ['A better', 'B edited', 'C']);
});

test('relocateParagraph follows a paragraph through moves, inserts and deletes', () => {
  const p = paragraphProposal(1, 'B better');
  const at = (paragraphs) => relocateParagraph(p, { ...data, paragraphs });
  assert.equal(at(['A', 'B', 'C']), p.target);
  assert.deepEqual(at(['New', 'A', 'B', 'C']), { kind: 'paragraph', index: 2 });
  assert.deepEqual(at(['B', 'A', 'C']), { kind: 'paragraph', index: 0 });
  assert.deepEqual(at(['A', 'C']), { kind: 'paragraph', index: 1 }); // gone, but position 1 still exists: stale there
  assert.equal(at(['A']), null);
  assert.equal(at(['A', 'B edited', 'C']), p.target); // edited in place: stays
  // Applying a moved proposal reads its text from where it was made.
  const moved = { ...p, target: { kind: 'paragraph', index: 0 }, origin: p.target };
  const current = { ...data, paragraphs: ['B', 'A', 'C'] };
  assert.equal(isLetterProposalStale(moved, current), false);
  assert.deepEqual(applyLetterProposal(current, moved).paragraphs, ['B better', 'A', 'C']);
  const whole = letterProposal();
  assert.equal(relocateParagraph(whole, current), whole.target);
});

test('letterChanges lists only what changed', () => {
  assert.deepEqual(letterChanges(paragraphProposal(2, 'C better')), [{ label: 'Paragraph 3', before: 'C', after: 'C better' }]);
  assert.deepEqual(letterChanges(letterProposal()), [
    { label: 'Salutation', before: 'Dear Hiring Manager,', after: 'Dear Jane,' },
    { label: 'Letter', before: 'A\n\nB\n\nC', after: 'New one\n\nNew two' },
    { label: 'Closing', before: 'Sincerely,', after: 'Best,' },
  ]);
});
