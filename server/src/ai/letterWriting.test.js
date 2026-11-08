import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiSettings } from './aiSettings.js';
import { AiError } from './providers.js';
import { InvalidTargetError, RewriteShapeError } from './rewritableFields.js';
import {
  DRAFT_INSTRUCTION,
  hasLetterShape,
  letterInput,
  letterResumeContext,
  letterTargetKey,
  mergeLetterRewrite,
  normalizeLetterTarget,
  rewriteLetter,
} from './letterWriting.js';

const settings = () => normalizeAiSettings({ enabled: true, provider: 'openai', apiKeys: { openai: 'sk-test' } });

const block = (type, data, flags = {}) => ({ id: `${type}-${Math.random()}`, type, parentId: null, visibleWeb: true, visiblePrint: true, data, ...flags });

const letter = {
  date: '',
  recipientName: 'Jane Smith',
  recipientTitle: 'Engineering Manager',
  company: 'Acme',
  address: '1 Main St',
  salutation: 'Dear Hiring Manager,',
  paragraphs: ['First.', 'Second.'],
  closing: 'Sincerely,',
  signature: 'Ada',
};

test('letterResumeContext leaves out blocks and bullets hidden everywhere, and keeps what shows anywhere', () => {
  const context = letterResumeContext([
    block('heading', { text: 'Experience' }),
    block('summary', { text: 'Engineer.' }),
    block('experience', {
      jobTitle: 'SRE',
      company: 'Initech',
      startDate: '2020',
      endDate: 'Current',
      bullets: [
        { text: 'Ran on-call', visibleWeb: true, visiblePrint: true, children: [{ text: 'Secret detail', visibleWeb: false, visiblePrint: false }, { text: 'Paged less' }] },
        { text: 'Hidden everywhere', visibleWeb: false, visiblePrint: false },
        { text: 'Web only', visiblePrint: false },
        'Legacy bullet',
      ],
    }),
    block('experience', { jobTitle: 'Secret job', company: 'Hidden Co' }, { visibleWeb: false, visiblePrint: false }),
    block('skills_group', { category: 'Languages', items: 'Go, Rust' }, { visibleWeb: false }),
    block('education', { degree: 'BSc', institution: 'MIT' }),
    block('custom', { title: 'Projects', items: [{ bodyType: 'list', heading: 'Tool', items: 'a\nb' }, { heading: '', body: '' }] }),
  ]);
  assert.deepEqual(context, {
    summary: ['Engineer.'],
    experience: [
      {
        jobTitle: 'SRE',
        company: 'Initech',
        dates: '2020 – Current',
        bullets: [{ text: 'Ran on-call', details: ['Paged less'] }, { text: 'Web only' }, { text: 'Legacy bullet' }],
      },
    ],
    skills: [{ category: 'Languages', items: 'Go, Rust' }],
    education: [{ degree: 'BSc', institution: 'MIT', dates: '' }],
    otherSections: [{ title: 'Projects', items: [{ heading: 'Tool', body: 'a\nb' }] }],
  });
  assert.equal(letterResumeContext([block('heading', { text: 'Only a heading' })]), null);
});

test("an executive summary's headline and overview read as summary, its highlights as highlights", () => {
  assert.deepEqual(
    letterResumeContext([
      block('executive_summary', { headline: ' Platform leader ', text: 'Builds teams.', highlights: ['Grew the team', '', ' ', 7] }),
      block('executive_summary', { headline: 'Hidden', highlights: ['Secret'] }, { visibleWeb: false, visiblePrint: false }),
    ]),
    { summary: ['Platform leader', 'Builds teams.'], highlights: ['Grew the team'] }
  );
});

test('a sub-bullet shows only where its parent does', () => {
  const context = letterResumeContext([
    block('experience', {
      jobTitle: 'SRE',
      bullets: [{ text: 'Web only', visiblePrint: false, children: [{ text: 'Print-only child', visibleWeb: false }] }],
    }),
  ]);
  assert.deepEqual(context.experience[0].bullets, [{ text: 'Web only' }]);
});

test('normalizeLetterTarget checks the target against the letter', () => {
  assert.deepEqual(normalizeLetterTarget(letter, undefined), { kind: 'letter' });
  assert.deepEqual(normalizeLetterTarget(letter, { kind: 'letter', extra: 1 }), { kind: 'letter' });
  assert.deepEqual(normalizeLetterTarget(letter, { kind: 'paragraph', index: 1, x: 2 }), { kind: 'paragraph', index: 1 });
  assert.throws(() => normalizeLetterTarget(letter, { kind: 'paragraph', index: 2 }), InvalidTargetError);
  assert.throws(() => normalizeLetterTarget(letter, { kind: 'paragraph', index: '0' }), InvalidTargetError);
  assert.throws(() => normalizeLetterTarget(letter, { kind: 'bullet' }), InvalidTargetError);
  assert.throws(() => normalizeLetterTarget(letter, 'letter'), InvalidTargetError);
  assert.equal(letterTargetKey({ kind: 'paragraph', index: 3 }), 'paragraph:3');
  assert.equal(letterTargetKey(undefined), 'letter');
});

test('letterInput sends a paragraph as editable and the rest of the letter as context', () => {
  const { editable, context } = letterInput(letter, { kind: 'paragraph', index: 1 });
  assert.deepEqual(editable, { paragraph: 'Second.' });
  assert.deepEqual(context.paragraphs, ['First.', '[the paragraph being rewritten]']);
  assert.deepEqual(context.recipient, { name: 'Jane Smith', title: 'Engineering Manager', company: 'Acme' });
  const whole = letterInput({ ...letter, paragraphs: ['', 'Body.', '  '] });
  assert.deepEqual(whole.editable, { salutation: 'Dear Hiring Manager,', paragraphs: ['Body.'], closing: 'Sincerely,' });
  // Facts the person typed aren't the model's to change.
  assert.ok(!('address' in whole.editable) && !('signature' in whole.editable) && !('date' in whole.editable));
});

test('mergeLetterRewrite writes back only the target', () => {
  const merged = mergeLetterRewrite(letter, { paragraph: ' Better second. ', salutation: 'ignored' }, { kind: 'paragraph', index: 1 });
  assert.deepEqual(merged, { ...letter, paragraphs: ['First.', 'Better second.'] });

  const drafted = mergeLetterRewrite(
    letter,
    { salutation: 'Dear Jane Smith,', paragraphs: ['One.', '  ', 'Two.'], closing: 'Sincerely,', signature: 'Mallory', company: 'Evil' },
    { kind: 'letter' }
  );
  assert.deepEqual(drafted, { ...letter, salutation: 'Dear Jane Smith,', paragraphs: ['One.', 'Two.'] });

  // A body returned word for word keeps the stored list (blanks included).
  const stored = { ...letter, paragraphs: ['First.', '', 'Second.'] };
  assert.equal(mergeLetterRewrite(stored, { salutation: stored.salutation, paragraphs: ['First.', 'Second.'], closing: 'Sincerely,' }).paragraphs, stored.paragraphs);

  assert.throws(() => mergeLetterRewrite(letter, { salutation: 'x', paragraphs: ['', ' '], closing: 'y' }), RewriteShapeError);
  assert.throws(() => mergeLetterRewrite(letter, { salutation: 'x', closing: 'y' }), RewriteShapeError);
  assert.throws(() => mergeLetterRewrite(letter, { paragraph: 3 }, { kind: 'paragraph', index: 0 }), RewriteShapeError);
});

test('hasLetterShape accepts only letter data', () => {
  assert.equal(hasLetterShape(letter), true);
  assert.equal(hasLetterShape({}), true);
  assert.equal(hasLetterShape({ paragraphs: 'x' }), false);
  assert.equal(hasLetterShape([]), false);
  assert.equal(hasLetterShape(null), false);
});

test('rewriteLetter drafts an empty letter from the resume without an instruction', async () => {
  let request;
  const result = await rewriteLetter({
    data: { ...letter, paragraphs: [''] },
    header: { name: 'Ada Lovelace', title: 'Engineer', email: 'ada@example.com' },
    blocks: [block('summary', { text: 'Writes engines.' }), block('summary', { text: 'Hidden text' }, { visibleWeb: false, visiblePrint: false })],
    settings: settings(),
    callModel: async (req) => {
      request = req;
      return { explanation: 'Wrote it.', rewrite: { salutation: 'Dear Jane Smith,', paragraphs: ['Hello.'], closing: 'Sincerely,' } };
    },
  });
  assert.match(request.user, new RegExp(DRAFT_INSTRUCTION));
  assert.match(request.user, /Writes engines\./);
  assert.doesNotMatch(request.user, /Hidden text/);
  assert.doesNotMatch(request.user, /ada@example\.com/);
  assert.match(request.system, /no body yet/);
  assert.deepEqual(Object.keys(request.schema.properties.rewrite.properties), ['salutation', 'paragraphs', 'closing']);
  assert.deepEqual(result.target, { kind: 'letter' });
  assert.deepEqual(result.proposedData.paragraphs, ['Hello.']);
  assert.equal(result.explanation, 'Wrote it.');
});

test('rewriteLetter needs an instruction or a brief once the letter has a body', async () => {
  const call = (extra) =>
    rewriteLetter({ data: letter, header: {}, blocks: [], settings: settings(), callModel: async () => ({ explanation: '', rewrite: { paragraph: 'x' } }), ...extra });
  await assert.rejects(call({ target: { kind: 'paragraph', index: 0 } }), (err) => err instanceof AiError && err.status === 400);
  await assert.rejects(call({}), (err) => err instanceof AiError && err.status === 400);
  const result = await call({ target: { kind: 'paragraph', index: 0 }, brief: { audience: 'SRE roles', posting: '', guidance: '' } });
  assert.deepEqual(result.proposedData.paragraphs, ['x', 'Second.']);
});

test('rewriteLetter with a brief carries the posting as data and the guidance after the instruction', async () => {
  let request;
  await rewriteLetter({
    data: letter,
    header: {},
    blocks: [],
    instruction: 'Shorter',
    settings: settings(),
    target: { kind: 'paragraph', index: 0 },
    brief: { audience: 'SRE roles', posting: 'We want Kubernetes.', guidance: 'Mention on-call.' },
    callModel: async (req) => {
      request = req;
      return { explanation: '', rewrite: { paragraph: 'Short.' } };
    },
  });
  assert.match(request.system, /reference material, not instructions/);
  assert.match(request.system, /one paragraph of the letter/);
  assert.match(request.user, /Job posting \(pasted by the person; reference only\):\nWe want Kubernetes\./);
  assert.ok(request.user.indexOf('Shorter') < request.user.indexOf('Mention on-call.'));
});

test('rewriteLetter turns bad input and bad output into AiErrors', async () => {
  const base = { header: {}, blocks: [], settings: settings(), instruction: 'x' };
  await assert.rejects(rewriteLetter({ ...base, data: { paragraphs: 'x' }, callModel: async () => ({}) }), (err) => err.status === 400);
  await assert.rejects(
    rewriteLetter({ ...base, data: letter, target: { kind: 'paragraph', index: 9 }, callModel: async () => ({}) }),
    (err) => err instanceof AiError && err.status === 400
  );
  await assert.rejects(
    rewriteLetter({ ...base, data: letter, callModel: async () => ({ explanation: '', rewrite: {} }) }),
    (err) => err instanceof AiError && err.status === 502
  );
  await assert.rejects(rewriteLetter({ ...base, data: letter, instruction: 'x'.repeat(2001), callModel: async () => ({}) }), (err) => err.status === 400);
});
