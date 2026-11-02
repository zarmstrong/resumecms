import test from 'node:test';
import assert from 'node:assert/strict';
import { RewriteShapeError, mergeRewrite, outputSchema, rewriteInput, textSimilarity } from './rewritableFields.js';

const bullet = (text, flags = {}, children = []) => ({ text, visibleWeb: true, visiblePrint: true, children, ...flags });

const experience = {
  jobTitle: 'Engineer',
  company: 'Acme',
  companyUrl: 'https://acme.example',
  startDate: '2020',
  endDate: 'Current',
  tagline: 'Makes anvils.',
  style: { spaceAbove: 'large' },
  bullets: [
    bullet('Built the deploy pipeline for all services', {}, [bullet('Cut deploy time in half')]),
    bullet('Ran on-call rotation for the platform team', { visiblePrint: false }),
  ],
};

test('rewriteInput separates editable prose from read-only facts', () => {
  const { editable, context } = rewriteInput('experience', experience);
  assert.deepEqual(editable, {
    tagline: 'Makes anvils.',
    bullets: [
      { text: 'Built the deploy pipeline for all services', children: [{ text: 'Cut deploy time in half' }] },
      { text: 'Ran on-call rotation for the platform team', children: [] },
    ],
  });
  assert.equal(context.company, 'Acme');
  assert.ok(!('companyUrl' in context));
});

test('rewriteInput normalizes legacy string bullets', () => {
  const { editable } = rewriteInput('experience', { bullets: ['Old style bullet'] });
  assert.deepEqual(editable.bullets, [{ text: 'Old style bullet', children: [] }]);
});

test('merge only touches allowlisted fields, even if the model returns others', () => {
  const { data } = mergeRewrite('summary', { text: 'old', style: { highlight: true } }, {
    text: ' new ',
    style: { highlight: false },
    secret: 'x',
  });
  assert.deepEqual(data, { text: 'new', style: { highlight: true } });
});

test('reword mode keeps each bullet\'s visibility by position', () => {
  const rewrite = {
    tagline: 'Makes very good anvils.',
    bullets: [
      { text: 'Designed the deploy pipeline', children: [{ text: 'Halved deploy time' }] },
      { text: 'Led on-call', children: [] },
    ],
  };
  const { data, bulletReview } = mergeRewrite('experience', experience, rewrite);
  assert.equal(data.companyUrl, 'https://acme.example');
  assert.deepEqual(data.style, { spaceAbove: 'large' });
  assert.equal(data.bullets[1].text, 'Led on-call');
  assert.equal(data.bullets[1].visiblePrint, false);
  assert.equal(data.bullets[0].children[0].text, 'Halved deploy time');
  assert.equal(bulletReview.items.length, 3);
  assert.deepEqual(bulletReview.removed, []);
  assert.equal(bulletReview.items.find((i) => i.after === 'Led on-call').wasHidden, true);
});

test('reword mode rejects a changed bullet count', () => {
  const rewrite = { tagline: '', bullets: [{ text: 'Only one now', children: [] }] };
  assert.throws(() => mergeRewrite('experience', experience, rewrite), RewriteShapeError);
});

test('reword mode rejects a changed sub-bullet count', () => {
  const rewrite = {
    tagline: '',
    bullets: [
      { text: 'a', children: [] },
      { text: 'b', children: [] },
    ],
  };
  assert.throws(() => mergeRewrite('experience', experience, rewrite), RewriteShapeError);
});

test('restructure mode carries visibility to the most similar original', () => {
  const rewrite = {
    tagline: 'Makes anvils.',
    bullets: [
      { text: 'Ran the on-call rotation for the platform team', children: [] },
      { text: 'Built the deploy pipeline for all services, cutting deploy time in half', children: [] },
      { text: 'Mentored two junior engineers', children: [] },
    ],
  };
  const { data, bulletReview } = mergeRewrite('experience', experience, rewrite, { allowBulletRestructure: true });
  assert.equal(data.bullets.length, 3);
  // The hidden-from-print bullet moved to the top and stays hidden.
  assert.equal(data.bullets[0].visiblePrint, false);
  assert.equal(data.bullets[1].visiblePrint, true);
  // A genuinely new bullet starts visible everywhere and has no "before".
  assert.equal(data.bullets[2].visibleWeb, true);
  assert.equal(bulletReview.items[2].before, null);
  // The sub-bullet was merged into its parent, so it's reported as removed.
  assert.deepEqual(bulletReview.removed, [{ depth: 1, before: 'Cut deploy time in half', wasHidden: false }]);
});

test('restructure mode never matches one original to two proposals', () => {
  const originals = { bullets: [bullet('Built the deploy pipeline', { visibleWeb: false })] };
  const rewrite = {
    tagline: '',
    bullets: [
      { text: 'Built the deploy pipeline', children: [] },
      { text: 'Built the deploy pipeline again', children: [] },
    ],
  };
  const { data } = mergeRewrite('experience', originals, rewrite, { allowBulletRestructure: true });
  assert.equal(data.bullets[0].visibleWeb, false);
  assert.equal(data.bullets[1].visibleWeb, true);
});

test('custom items map the generic body back to the field for their type', () => {
  const data = {
    title: 'Certs',
    items: [
      { heading: 'AWS', bodyType: 'list', items: 'a\nb' },
      { heading: 'Site', bodyType: 'link', label: 'View', url: 'https://x.example' },
      { heading: 'Legacy', body: 'old text' },
    ],
  };
  const { editable } = rewriteInput('custom', data);
  assert.deepEqual(editable.items.map((i) => i.body), ['a\nb', 'View', 'old text']);

  const { data: merged } = mergeRewrite('custom', data, {
    title: 'Certifications',
    items: [
      { heading: 'AWS', body: 'A\nB' },
      { heading: 'Site', body: 'See it' },
      { heading: 'Legacy', body: 'new text' },
    ],
  });
  assert.equal(merged.items[0].items, 'A\nB');
  assert.equal(merged.items[1].label, 'See it');
  assert.equal(merged.items[1].url, 'https://x.example');
  assert.equal(merged.items[2].text, 'new text');
});

test('custom rejects a changed item count', () => {
  const data = { title: 't', items: [{ heading: 'a', bodyType: 'text', text: 'x' }] };
  assert.throws(() => mergeRewrite('custom', data, { title: 't', items: [] }), RewriteShapeError);
});

test('missing fields in the model output are rejected, not silently blanked', () => {
  assert.throws(() => mergeRewrite('skills_group', { category: 'c', items: 'i' }, { category: 'c' }), RewriteShapeError);
});

test('output schemas satisfy strict structured-output rules', () => {
  function check(schema, path) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false, path);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), path);
      for (const [k, v] of Object.entries(schema.properties)) check(v, `${path}.${k}`);
    }
    if (schema.type === 'array') check(schema.items, `${path}[]`);
  }
  for (const type of ['heading', 'summary', 'skills_group', 'experience', 'custom']) check(outputSchema(type), type);
});

test('textSimilarity ignores case and punctuation', () => {
  assert.equal(textSimilarity('Led the team.', 'led THE team'), 1);
  assert.equal(textSimilarity('alpha', 'beta'), 0);
});
