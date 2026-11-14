import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLanding } from '../landing/resolveLanding.js';
import { THUMBNAIL_WIDTH, pageKey, presetPreviewPage, thumbnailPage, thumbnailScale, withTemplate } from './templateThumbnails.js';

const draft = {
  headline: 'Jo',
  subheadline: 'Engineer',
  photo: 'none',
  photoUrl: '',
  template: 'classic',
  sections: [
    { id: 'intro', kind: 'text', title: '', body: 'Hi' },
    { id: 'gone', kind: 'text', title: 'Draft only', body: 'Not yet', hidden: true },
    { id: 'rule', kind: 'divider', title: '' },
    {
      id: 'creds',
      kind: 'credentials',
      title: 'Licenses',
      credentials: [
        { kind: 'license', name: 'RN', issuer: '', number: '', issued: '', expires: '2001-01', url: '' },
        { kind: 'license', name: 'BLS', issuer: '', number: '', issued: '', expires: '', url: '' },
      ],
    },
  ],
};
const context = { site: {}, resumes: [], today: '2026-11-10' };

test('a thumbnail shows the page as it will be published, not the dimmed preview', () => {
  const page = thumbnailPage(draft, context);
  assert.deepEqual(page, resolveLanding(draft, context));
  const titles = page.sections.map((s) => s.title);
  assert.equal(titles.includes('Draft only'), false);
  assert.equal(page.sections.some((s) => s.hidden || s.id), false);
  const creds = page.sections.find((s) => s.kind === 'credentials');
  assert.deepEqual(
    creds.credentials.map((c) => c.name),
    ['BLS'],
  );
});

test('each thumbnail swaps in its own template and leaves the page alone', () => {
  const page = thumbnailPage(draft, context);
  const split = withTemplate(page, 'split');
  assert.equal(split.template, 'split');
  assert.equal(page.template, 'classic');
  assert.equal(split.sections, page.sections);
  // An id the registry doesn't know is passed through: LandingView draws it as classic.
  assert.equal(withTemplate(page, 'not-a-template').template, 'not-a-template');
});

test('the page box is scaled to its frame, and not drawn before the frame is measured', () => {
  assert.equal(thumbnailScale(THUMBNAIL_WIDTH), 1);
  assert.equal(thumbnailScale(THUMBNAIL_WIDTH / 8), 1 / 8);
  assert.equal(thumbnailScale(0), 0);
  assert.equal(thumbnailScale(-5), 0);
});

test('two resolutions of an unchanged draft share a key; an edit changes it', () => {
  const a = thumbnailPage(draft, context);
  const b = thumbnailPage({ ...draft }, context);
  assert.notEqual(a, b);
  assert.equal(pageKey(a), pageKey(b));
  assert.notEqual(pageKey(a), pageKey(thumbnailPage({ ...draft, headline: 'Jo Smith' }, context)));
  // A hidden section's edits don't show, so they don't redraw.
  const hiddenEdit = { ...draft, sections: draft.sections.map((s) => (s.id === 'gone' ? { ...s, body: 'Changed' } : s)) };
  assert.equal(pageKey(a), pageKey(thumbnailPage(hiddenEdit, context)));
});

test("picking another template doesn't change the key, since every thumbnail draws its own", () => {
  const a = thumbnailPage(draft, context);
  const b = thumbnailPage({ ...draft, template: 'split' }, context);
  assert.notEqual(a.template, b.template);
  assert.equal(pageKey(a), pageKey(b));
  // Its colors and fonts still count.
  assert.notEqual(pageKey(a), pageKey(thumbnailPage({ ...draft, style: { source: 'custom', colors: { accent: '#ff0000', heading: '', text: '', background: '' }, font: '', nameFont: '' } }, context)));
  assert.equal(pageKey(null), '');
});

test("an SEO edit doesn't change the key, since no template draws it", () => {
  const a = thumbnailPage(draft, context);
  const b = { ...a, seo: { ...(a.seo || {}), title: 'Something else' } };
  assert.equal(pageKey(a), pageKey(b));
});

test('the preset preview draws an empty section as a note in its place, and leaves hidden ones out', () => {
  const withEmpty = {
    ...draft,
    sections: [
      ...draft.sections.slice(0, 1),
      { id: 'faq', kind: 'faq', title: 'Questions', entries: [{ question: '', answer: '' }], column: 'side' },
      { id: 'hiddenEmpty', kind: 'stats', title: 'Numbers', stats: [], hidden: true },
      ...draft.sections.slice(1),
    ],
  };
  const page = presetPreviewPage(withEmpty, context);
  assert.deepEqual(
    page.sections.map((s) => [s.id, s.kind, s.title]),
    [
      ['intro', 'text', ''],
      ['faq', 'text', 'Questions'],
      ['rule', 'divider', ''],
      ['creds', 'credentials', 'Licenses'],
    ],
  );
  const note = page.sections[1];
  assert.equal(note.body, '*Questions and answers: empty until you fill it in.*');
  assert.equal(note.column, 'side');
  // Everything else is the page as published.
  const published = resolveLanding(withEmpty, context, { withIds: true });
  assert.deepEqual({ ...page, sections: undefined }, { ...published, sections: undefined });
  assert.deepEqual(page.sections[3], published.sections.find((s) => s.id === 'creds'));
});

test("the preset preview doesn't call a section with something in it empty", () => {
  const page = presetPreviewPage(
    {
      ...draft,
      sections: [
        {
          id: 'lapsed',
          kind: 'credentials',
          title: 'Licenses',
          credentials: [{ kind: 'license', name: 'RN', issuer: '', number: '', issued: '', expires: '2001-01', url: '' }],
        },
        { id: 'roles', kind: 'experience', title: 'Experience', resumeId: 'gone', count: 3, showDates: true },
      ],
    },
    context,
  );
  // Only expired credentials: left out, as published.
  assert.deepEqual(
    page.sections.map((s) => [s.id, s.body]),
    [['roles', '*Experience: shown from your resume once it has some to show.*']],
  );
});
