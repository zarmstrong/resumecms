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
    { kind: 'links', title: 'Elsewhere', links: [{ type: 'github', label: 'https://github.com/jo', url: 'https://github.com/jo' }] },
    { kind: 'items', title: 'Projects', items: [{ title: 'Tool', text: '', url: '' }] },
    { kind: 'resumes', title: '', cards: [{ label: 'Engineer', blurb: 'b', href: '/resume' }] },
  ]);
  assert.equal(out.photoUrl, context.photoUrl);
  assert.deepEqual(out.site, { title: 'T' });
  assert.equal(resolveLanding({ ...draft, photo: 'none' }, context).photoUrl, '');
  assert.equal(resolveLanding(draft, null).sections.some((s) => s.kind === 'resumes'), false);
});

test('a text section splits into paragraphs on blank lines', () => {
  assert.deepEqual(textParagraphs('One\nstill one\n\n  \nTwo\n'), ['One\nstill one', 'Two']);
  assert.deepEqual(textParagraphs(''), []);
});
