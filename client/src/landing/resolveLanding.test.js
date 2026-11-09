import test from 'node:test';
import assert from 'node:assert/strict';
import { textParagraphs, resolveLanding } from './resolveLanding.js';

const draft = {
  headline: 'Jo',
  subheadline: 'Engineer',
  photo: 'resume',
  photoUrl: '',
  sections: [
    { id: 'intro', kind: 'text', title: '', body: 'Hi' },
    { id: 'empty', kind: 'text', title: 'About', body: ' ' },
    {
      id: 'links',
      kind: 'links',
      title: 'Elsewhere',
      links: [
        { type: 'github', label: '', url: 'https://github.com/jo' },
        { type: 'phone', label: '+1 555 555 0100', url: 'tel:+15555550100' },
        { label: 'half typed', url: '' },
        { label: 'bad', url: 'java\tscript:alert(1)' },
      ],
    },
    {
      id: 'projects',
      kind: 'items',
      title: 'Projects',
      items: [
        { title: 'Tool', text: '', url: 'java\tscript:alert(1)' },
        { title: ' ', text: '', url: 'https://x.example' },
      ],
    },
    { id: 'cards', kind: 'resumes', title: '', cards: [{ resumeId: 'main', label: '', blurb: 'b' }, { resumeId: 'private', label: 'Secret', blurb: '' }] },
  ],
};
const context = { photoUrl: 'data:image/jpeg;base64,AA', site: { title: 'T' }, resumes: [{ id: 'main', href: '/resume', title: 'Engineer' }] };

test('the preview resolves the draft like the server does', () => {
  const out = resolveLanding(draft, context);
  assert.deepEqual(out.sections, [
    { kind: 'text', title: '', body: 'Hi' },
    {
      kind: 'links',
      title: 'Elsewhere',
      links: [
        { type: 'github', label: 'https://github.com/jo', url: 'https://github.com/jo' },
        { type: 'phone', label: '+1 555 555 0100', url: 'tel:+15555550100' },
      ],
    },
    { kind: 'items', title: 'Projects', items: [{ title: 'Tool', text: '', url: '' }] },
    { kind: 'resumes', title: '', cards: [{ label: 'Engineer', blurb: 'b', href: '/resume' }] },
  ]);
  assert.equal(out.photoUrl, context.photoUrl);
  assert.deepEqual(out.site, { title: 'T' });
  assert.equal(resolveLanding({ ...draft, photo: 'none' }, context).photoUrl, '');
  assert.equal(resolveLanding(draft, null).sections.some((s) => s.kind === 'resumes'), false);
});

test('hero actions and card PDFs resolve like the server does', () => {
  const ctx = {
    ...context,
    resumes: [
      { id: 'main', href: '/resume', title: 'Engineer', pdfHref: '/api/public/resume.pdf?v=1-2' },
      { id: 'sales', href: '/r/sales', title: 'Sales', pdfHref: '' },
    ],
  };
  const landing = {
    ...draft,
    availability: 'Open to work',
    actions: [
      { type: 'link', label: 'Email me', url: 'mailto:jo@example.com' },
      { type: 'link', label: '', url: 'https://cal.example/jo' },
      { type: 'link', label: 'Bad', url: 'java\tscript:alert(1)' },
      { type: 'link', label: 'Half typed', url: '' },
      { type: 'resume', label: '', resumeId: 'main', open: 'pdf' },
      { type: 'resume', label: 'Sales PDF', resumeId: 'sales', open: 'pdf' },
      { type: 'resume', label: '', resumeId: 'sales', open: 'page' },
      { type: 'resume', label: 'Secret', resumeId: 'private', open: 'page' },
    ],
    sections: [
      {
        id: 'cards',
        kind: 'resumes',
        title: '',
        cards: [
          { resumeId: 'main', label: '', blurb: '', showPdf: true },
          { resumeId: 'sales', label: '', blurb: '', showPdf: true },
        ],
      },
    ],
  };
  const out = resolveLanding(landing, ctx);
  assert.equal(out.availability, 'Open to work');
  assert.deepEqual(out.actions, [
    { label: 'Email me', href: 'mailto:jo@example.com' },
    { label: 'https://cal.example/jo', href: 'https://cal.example/jo' },
    { label: 'Download my resume (PDF)', href: '/api/public/resume.pdf?v=1-2' },
    { label: 'View my resume', href: '/r/sales' },
  ]);
  assert.deepEqual(out.sections[0].cards, [
    { label: 'Engineer', blurb: '', href: '/resume', pdfHref: '/api/public/resume.pdf?v=1-2' },
    { label: 'Sales', blurb: '', href: '/r/sales' },
  ]);
  // A draft from before actions (or no context yet) shows none.
  assert.deepEqual(resolveLanding(draft, ctx).actions, []);
  assert.equal(resolveLanding(draft, ctx).availability, '');
  assert.deepEqual(resolveLanding(landing, null).actions.map((a) => a.label), ['Email me', 'https://cal.example/jo']);
});

test('a text section splits into paragraphs on blank lines', () => {
  assert.deepEqual(textParagraphs('One\nstill one\n\n  \nTwo\n'), ['One\nstill one', 'Two']);
  assert.deepEqual(textParagraphs(''), []);
});
