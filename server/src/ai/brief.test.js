import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIEF_LIMITS, normalizeBrief, outlineScope, resumeOutline } from './brief.js';

const statusOf = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

test('a brief is trimmed, and its optional fields default to empty', () => {
  assert.deepEqual(normalizeBrief({ audience: '  SRE roles ' }), { audience: 'SRE roles', posting: '', guidance: '' });
  assert.deepEqual(normalizeBrief({ audience: 'SRE', posting: ' We need on-call. ', guidance: null }), {
    audience: 'SRE',
    posting: 'We need on-call.',
    guidance: '',
  });
});

test('a brief needs an audience, strings, known fields, and fits its caps', () => {
  for (const bad of [null, 'SRE', ['SRE'], {}, { audience: '   ' }, { audience: 3 }, { audience: 'SRE', posting: {} }, { audience: 'SRE', notes: 'x' }]) {
    assert.equal(statusOf(() => normalizeBrief(bad)), 400, JSON.stringify(bad));
  }
  for (const [field, limit] of Object.entries(BRIEF_LIMITS)) {
    const brief = { audience: 'SRE', [field]: 'x'.repeat(limit) };
    assert.equal(normalizeBrief(brief)[field].length, limit, `${field} at its cap`);
    assert.equal(statusOf(() => normalizeBrief({ ...brief, [field]: 'x'.repeat(limit + 1) })), 400, `${field} past its cap`);
  }
  // the cap counts what's left after trimming
  assert.equal(normalizeBrief({ audience: ` ${'x'.repeat(BRIEF_LIMITS.audience)} ` }).audience.length, BRIEF_LIMITS.audience);
});

const block = (id, type, data, { web = true, print = true } = {}) => ({ id, type, data, visibleWeb: web, visiblePrint: print });

test("a summary's outline lists jobs, skills and education, in order, and leaves itself out", () => {
  const summary = block('s', 'summary', { text: 'Engineer.' });
  const blocks = [
    block('h', 'heading', { text: 'Experience' }),
    summary,
    block('e1', 'experience', { jobTitle: 'SRE', company: 'Acme', startDate: '2021', endDate: 'Present', bullets: [{ text: 'secret sauce' }] }),
    block('e2', 'experience', { jobTitle: ' Engineer ', company: 'Globex', startDate: '2018' }),
    block('k', 'skills_group', { category: 'Cloud', items: 'AWS, GCP' }),
    block('k2', 'skills_group', { category: 'Empty', items: '' }),
    block('ed', 'education', { degree: 'BSc', institution: 'MIT' }),
    block('c', 'custom', { title: 'Talks' }),
    block('s2', 'summary', { text: 'Another summary.' }),
  ];
  assert.deepEqual(resumeOutline(blocks, summary), {
    experience: [
      { jobTitle: 'SRE', company: 'Acme', dates: '2021 – Present' },
      { jobTitle: 'Engineer', company: 'Globex', dates: '2018' },
    ],
    skills: [{ category: 'Cloud', items: 'AWS, GCP' }],
    education: [{ degree: 'BSc', institution: 'MIT' }],
  });
});

test('the outline leaves out whatever is hidden anywhere the summary shows', () => {
  const blocks = [
    block('web', 'experience', { jobTitle: 'Web only', company: 'A' }, { print: false }),
    block('print', 'experience', { jobTitle: 'Print only', company: 'B' }, { web: false }),
    block('both', 'experience', { jobTitle: 'Both', company: 'C' }),
    block('none', 'skills_group', { category: 'Hidden', items: 'Secret' }, { web: false, print: false }),
  ];
  const titles = (summary) => resumeOutline(blocks, summary)?.experience.map((e) => e.jobTitle);
  assert.deepEqual(titles(block('s', 'summary', {})), ['Both']);
  assert.deepEqual(titles(block('s', 'summary', {}, { print: false })), ['Web only', 'Both']);
  assert.deepEqual(titles(block('s', 'summary', {}, { web: false })), ['Print only', 'Both']);
  // hidden everywhere for now, so it may be unhidden anywhere
  assert.deepEqual(titles(block('s', 'summary', {}, { web: false, print: false })), ['Both']);
  assert.equal(resumeOutline(blocks, block('s', 'summary', {})).skills, undefined);
});

test('an outline with nothing in it is null', () => {
  const summary = block('s', 'summary', {});
  assert.equal(resumeOutline([summary, block('h', 'heading', { text: 'x' }), block('e', 'experience', {})], summary), null);
});

test('outlineScope: a summary only when tailored, an executive summary always and with accomplishments', () => {
  assert.equal(outlineScope('summary', false), null);
  assert.deepEqual(outlineScope('summary', true), { accomplishments: false });
  assert.deepEqual(outlineScope('executive_summary', false), { accomplishments: true });
  assert.deepEqual(outlineScope('executive_summary', true), { accomplishments: true });
  assert.equal(outlineScope('experience', true), null);
});

test("an executive summary's outline has each job's accomplishments, leaving out bullets hidden where it shows", () => {
  const job = block('e', 'experience', {
    jobTitle: 'SRE',
    company: 'Acme',
    tagline: ' Makes anvils. ',
    description: 'Ran the platform.',
    bullets: [
      'Legacy string bullet',
      { text: 'Shown', children: [{ text: 'Shown child' }, { text: 'Print-only child', visibleWeb: false }] },
      { text: 'Web-only', visiblePrint: false, children: [{ text: 'Child of web-only' }] },
      { text: 'Hidden', visibleWeb: false, visiblePrint: false },
      null,
      { text: '  ' },
    ],
  });
  const bare = block('b', 'experience', { jobTitle: 'Intern', company: 'Globex' });
  const bullets = (summary) => resumeOutline([job, bare], summary, { accomplishments: true }).experience[0].bullets;
  const exec = block('x', 'executive_summary', {});
  assert.deepEqual(resumeOutline([job, bare], exec, { accomplishments: true }).experience, [
    {
      jobTitle: 'SRE',
      company: 'Acme',
      dates: '',
      tagline: 'Makes anvils.',
      description: 'Ran the platform.',
      bullets: ['Legacy string bullet', 'Shown', 'Shown child'],
    },
    { jobTitle: 'Intern', company: 'Globex', dates: '' },
  ]);
  assert.deepEqual(bullets(block('x', 'executive_summary', {}, { print: false })), [
    'Legacy string bullet',
    'Shown',
    'Shown child',
    'Web-only',
    'Child of web-only',
  ]);
  assert.deepEqual(bullets(block('x', 'executive_summary', {}, { web: false })), [
    'Legacy string bullet',
    'Shown',
    'Shown child',
    'Print-only child',
  ]);
  // without accomplishments (a tailored summary), none of it is sent
  assert.deepEqual(resumeOutline([job], exec).experience, [{ jobTitle: 'SRE', company: 'Acme', dates: '' }]);
});
