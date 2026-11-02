import test from 'node:test';
import assert from 'node:assert/strict';
import { RewriteShapeError, hasRewritableShape, mergeRewrite, outputSchema, rewriteInput, textSimilarity } from './rewritableFields.js';

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
    description: '',
    bullets: [
      { text: 'Built the deploy pipeline for all services', children: [{ text: 'Cut deploy time in half' }] },
      { text: 'Ran on-call rotation for the platform team', hidden: true, children: [] },
    ],
  });
  assert.equal(context.company, 'Acme');
  assert.ok(!('companyUrl' in context));
});

test('rewriteInput marks bullets hidden in either mode, with their sub-bullets', () => {
  const { editable } = rewriteInput('experience', {
    bullets: [
      bullet('Visible', {}, [bullet('Visible child'), bullet('Web-hidden child', { visibleWeb: false })]),
      bullet('Print-hidden', { visiblePrint: false }, [bullet('Child of hidden')]),
    ],
  });
  assert.deepEqual(editable.bullets, [
    { text: 'Visible', children: [{ text: 'Visible child' }, { text: 'Web-hidden child', hidden: true }] },
    { text: 'Print-hidden', hidden: true, children: [{ text: 'Child of hidden', hidden: true }] },
  ]);
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
    description: '',
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

test('an experience description can be written where there was none', () => {
  const rewrite = {
    tagline: 'Makes anvils.',
    description: ' Owned deploys and on-call for the platform team. ',
    bullets: [
      { text: 'Built the deploy pipeline for all services', children: [{ text: 'Cut deploy time in half' }] },
      { text: 'Ran on-call rotation for the platform team', children: [] },
    ],
  };
  const { data } = mergeRewrite('experience', experience, rewrite);
  assert.equal(data.description, 'Owned deploys and on-call for the platform team.');
  assert.equal(data.tagline, 'Makes anvils.');
});

test('an experience rewrite missing the description is rejected', () => {
  const rewrite = { tagline: 'Makes anvils.', bullets: [] };
  assert.throws(() => mergeRewrite('experience', { bullets: [] }, rewrite), RewriteShapeError);
});

test('a field the model left alone keeps its stored value exactly', () => {
  const data = { tagline: 'Makes anvils.\n', bullets: [] };
  const rewrite = { tagline: 'Makes anvils.', description: '', bullets: [] };
  const { data: merged } = mergeRewrite('experience', data, rewrite);
  assert.equal(merged.tagline, 'Makes anvils.\n');
  // A description the block never had isn't saved as an empty string.
  assert.equal(merged.description, undefined);
});

test('reword mode rejects a changed bullet count', () => {
  const rewrite = { tagline: '', description: '', bullets: [{ text: 'Only one now', children: [] }] };
  assert.throws(() => mergeRewrite('experience', experience, rewrite), RewriteShapeError);
});

test('reword mode rejects a changed sub-bullet count', () => {
  const rewrite = {
    tagline: '',
    description: '',
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
    description: '',
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
    description: '',
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

test('textSimilarity handles non-Latin and accented text', () => {
  // Russian with no ASCII letters used to tokenize to nothing, which made
  // every pair of bullets look identical. 0.3 is the match threshold.
  assert.ok(textSimilarity('Управлял командой', 'Снизил расходы на треть') < 0.3);
  assert.ok(textSimilarity('Управлял командой из пяти', 'Управлял командой') >= 0.3);
  assert.ok(textSimilarity('売上を向上させた', '新しい採用制度を作った') < 0.3);
  assert.ok(textSimilarity('売上を向上させた', '売上を大幅に向上させた') >= 0.3);
  assert.equal(textSimilarity('Amélioré la qualité', 'Ameliore la qualite'), 1);
});

test('restructure mode matches non-Latin bullets by content, not position', () => {
  const data = {
    bullets: [bullet('Управлял командой из пяти инженеров'), bullet('Снизил расходы на треть', { visiblePrint: false })],
  };
  const rewrite = {
    tagline: '',
    description: '',
    bullets: [
      { text: 'Снизил расходы на треть за год', children: [] },
      { text: 'Управлял командой из пяти инженеров', children: [] },
    ],
  };
  const { data: merged } = mergeRewrite('experience', data, rewrite, { allowBulletRestructure: true });
  assert.equal(merged.bullets[0].visiblePrint, false);
  assert.equal(merged.bullets[1].visiblePrint, true);
});

test('rewriting a legacy custom item drops its old body field', () => {
  const data = { title: 'Talks', items: [{ heading: 'Conf', body: 'Spoke about things.' }] };
  const rewrite = { title: 'Talks', items: [{ heading: 'Conf', body: 'Spoke about deploys.' }] };
  const { data: merged } = mergeRewrite('custom', data, rewrite);
  assert.deepEqual(merged.items[0], { heading: 'Conf', bodyType: 'text', text: 'Spoke about deploys.' });
});

test('hasRewritableShape rejects data the merge code would crash on', () => {
  assert.equal(hasRewritableShape('experience', experience), true);
  assert.equal(hasRewritableShape('experience', { bullets: ['legacy string'] }), true);
  assert.equal(hasRewritableShape('experience', {}), true);
  assert.equal(hasRewritableShape('experience', { bullets: 'x' }), false);
  assert.equal(hasRewritableShape('experience', { bullets: [null] }), false);
  assert.equal(hasRewritableShape('experience', { bullets: [{ text: 'a', children: 'x' }] }), false);
  assert.equal(hasRewritableShape('custom', { items: [{ heading: 'h' }] }), true);
  assert.equal(hasRewritableShape('custom', { items: {} }), false);
  assert.equal(hasRewritableShape('custom', { items: ['text'] }), false);
  assert.equal(hasRewritableShape('summary', null), false);
  assert.equal(hasRewritableShape('summary', []), false);
});
