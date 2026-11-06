import test from 'node:test';
import assert from 'node:assert/strict';
import { introParagraphs, resolveLanding } from './resolveLanding.js';

const draft = {
  headline: 'Jo',
  subheadline: 'Engineer',
  intro: 'Hi',
  photo: 'resume',
  photoUrl: '',
  links: [
    { type: 'github', label: '', url: 'https://github.com/jo' },
    { label: 'half typed', url: '' },
    { label: 'bad', url: 'java\tscript:alert(1)' },
  ],
  resumes: [{ resumeId: 'main', label: '', blurb: 'b' }, { resumeId: 'private', label: 'Secret', blurb: '' }],
};
const context = { photoUrl: 'data:image/jpeg;base64,AA', site: { title: 'T' }, resumes: [{ id: 'main', href: '/resume', title: 'Engineer' }] };

test('the preview resolves the draft like the server does', () => {
  const out = resolveLanding(draft, context);
  assert.deepEqual(out.links, [{ type: 'github', label: 'https://github.com/jo', url: 'https://github.com/jo' }]);
  assert.deepEqual(out.resumes, [{ label: 'Engineer', blurb: 'b', href: '/resume' }]);
  assert.equal(out.photoUrl, context.photoUrl);
  assert.deepEqual(out.site, { title: 'T' });
  assert.equal(resolveLanding({ ...draft, photo: 'none' }, context).photoUrl, '');
  assert.equal(resolveLanding(draft, null).resumes.length, 0);
});

test('the intro splits into paragraphs on blank lines', () => {
  assert.deepEqual(introParagraphs('One\nstill one\n\n  \nTwo\n'), ['One\nstill one', 'Two']);
  assert.deepEqual(introParagraphs(''), []);
});
