import test from 'node:test';
import assert from 'node:assert/strict';
import {
  InvalidTargetError,
  RewriteShapeError,
  hasRewritableShape,
  mergeRewrite,
  normalizeTarget,
  outputSchema,
  rewriteInput,
  targetKey,
  textSimilarity,
} from './rewritableFields.js';
import { letterOutputSchema } from './letterWriting.js';

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

const DESCRIPTION = { kind: 'description' };

test('an experience description can be written where there was none, changing nothing else', () => {
  const rewrite = { description: ' Owned deploys and on-call for the platform team. ', tagline: 'Ignored', bullets: [] };
  const { data, bulletReview } = mergeRewrite('experience', experience, rewrite, { target: DESCRIPTION });
  assert.deepEqual(data, { ...experience, description: 'Owned deploys and on-call for the platform team.' });
  assert.equal(bulletReview, undefined);
});

test('a description rewrite missing the description is rejected', () => {
  assert.throws(() => mergeRewrite('experience', { bullets: [] }, {}, { target: DESCRIPTION }), RewriteShapeError);
});

test('a block or bullet rewrite leaves the description byte-identical, whatever the model returns', () => {
  const data = { ...experience, description: 'Owned deploys.\n' };
  const block = {
    tagline: 'Makes anvils.',
    description: 'Something else entirely.',
    bullets: [
      { text: 'Built the deploy pipeline for all services', children: [{ text: 'Cut deploy time in half' }] },
      { text: 'Ran on-call rotation for the platform team', children: [] },
    ],
  };
  assert.equal(mergeRewrite('experience', data, block).data.description, 'Owned deploys.\n');
  const bullet = { bullet: { text: 'Led on-call', children: [] }, description: 'Something else entirely.' };
  assert.equal(mergeRewrite('experience', data, bullet, { target: { kind: 'bullet', path: [1] } }).data.description, 'Owned deploys.\n');
  // A block that never had a description doesn't gain one.
  assert.ok(!('description' in mergeRewrite('experience', experience, block).data));
});

test('a field the model left alone keeps its stored value exactly', () => {
  const data = { tagline: 'Makes anvils.\n', bullets: [] };
  const { data: merged } = mergeRewrite('experience', data, { tagline: 'Makes anvils.', bullets: [] });
  assert.equal(merged.tagline, 'Makes anvils.\n');
  // A description the block never had isn't saved as an empty string.
  const { data: described } = mergeRewrite('experience', data, { description: '' }, { target: DESCRIPTION });
  assert.equal(described.description, undefined);
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

test('restructure mode keeps a promoted sub-bullet of a hidden bullet hidden', () => {
  const originals = {
    bullets: [bullet('Confidential client engagement', { visiblePrint: false }, [bullet('Migrated their billing system')])],
  };
  const rewrite = {
    tagline: '',
    description: '',
    bullets: [
      { text: 'Confidential client engagement', children: [] },
      { text: 'Migrated their billing system', children: [] },
    ],
  };
  const { data, bulletReview } = mergeRewrite('experience', originals, rewrite, { allowBulletRestructure: true });
  // Never shown in print before (its parent wasn't), so not shown now.
  assert.equal(data.bullets[1].visiblePrint, false);
  assert.equal(data.bullets[1].visibleWeb, true);
  assert.equal(bulletReview.items[1].wasHidden, true);
});

test('reword mode flags a sub-bullet of a hidden bullet in the review, keeping its own flags', () => {
  const originals = { bullets: [bullet('Parent', { visibleWeb: false }, [bullet('Child')])] };
  const rewrite = { tagline: '', description: '', bullets: [{ text: 'Parent!', children: [{ text: 'Child!' }] }] };
  const { data, bulletReview } = mergeRewrite('experience', originals, rewrite);
  assert.equal(data.bullets[0].children[0].visibleWeb, true);
  assert.equal(bulletReview.items[1].wasHidden, true);
  assert.equal(bulletReview.items[1].visibleWeb, false);
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
  check(outputSchema('experience', { kind: 'description' }), 'experience/description');
  check(outputSchema('experience', { kind: 'bullet', path: [0] }), 'experience/bullet [0]');
  check(outputSchema('experience', { kind: 'bullet', path: [0, 0] }), 'experience/bullet [0,0]');
  check(outputSchema('custom', { kind: 'item', index: 0 }), 'custom/item');
  check(letterOutputSchema(), 'cover letter');
  check(letterOutputSchema({ kind: 'paragraph', index: 0 }), 'cover letter/paragraph');
});

test('output schemas list only the target\'s fields', () => {
  const fields = (schema) => Object.keys(schema.properties.rewrite.properties);
  assert.deepEqual(fields(outputSchema('experience')), ['tagline', 'bullets']);
  assert.deepEqual(fields(outputSchema('experience', { kind: 'description' })), ['description']);
  assert.deepEqual(fields(outputSchema('experience', { kind: 'bullet', path: [0] })), ['bullet']);
  assert.ok('children' in outputSchema('experience', { kind: 'bullet', path: [0] }).properties.rewrite.properties.bullet.properties);
  assert.deepEqual(Object.keys(outputSchema('experience', { kind: 'bullet', path: [0, 1] }).properties.rewrite.properties.bullet.properties), ['text']);
  assert.deepEqual(fields(outputSchema('custom', { kind: 'item', index: 0 })), ['heading', 'body']);
});

test('targetKey gives each target a stable string', () => {
  assert.equal(targetKey(undefined), 'block');
  assert.equal(targetKey({ kind: 'block' }), 'block');
  assert.equal(targetKey({ kind: 'description' }), 'description');
  assert.equal(targetKey({ kind: 'bullet', path: [2] }), 'bullet:2');
  assert.equal(targetKey({ kind: 'bullet', path: [2, 0] }), 'bullet:2.0');
  assert.equal(targetKey({ kind: 'item', index: 3 }), 'item:3');
});

test('normalizeTarget defaults to the block and strips stray keys', () => {
  assert.deepEqual(normalizeTarget('summary', {}, undefined), { kind: 'block' });
  assert.deepEqual(normalizeTarget('experience', experience, { kind: 'bullet', path: [0, 0], extra: 1 }), { kind: 'bullet', path: [0, 0] });
});

test('normalizeTarget rejects targets that do not fit the block', () => {
  const bad = [
    ['summary', {}, 'nope'],
    ['summary', {}, { kind: 'description' }],
    ['custom', { items: [] }, { kind: 'bullet', path: [0] }],
    ['experience', experience, { kind: 'item', index: 0 }],
    ['experience', experience, { kind: 'bullet', path: [] }],
    ['experience', experience, { kind: 'bullet', path: [0, 0, 0] }],
    ['experience', experience, { kind: 'bullet', path: [-1] }],
    ['experience', experience, { kind: 'bullet', path: ['0'] }],
    ['experience', experience, { kind: 'bullet', path: [5] }],
    ['experience', experience, { kind: 'bullet', path: [1, 0] }],
    ['custom', { items: [{}] }, { kind: 'item', index: 1 }],
    ['experience', experience, { kind: 'whole' }],
  ];
  for (const [type, data, target] of bad) {
    assert.throws(() => normalizeTarget(type, data, target), InvalidTargetError, JSON.stringify(target));
  }
});

test('a description target edits only the description, with the rest as context', () => {
  const { editable, context } = rewriteInput('experience', { ...experience, description: 'Old blurb' }, { kind: 'description' });
  assert.deepEqual(editable, { description: 'Old blurb' });
  assert.equal(context.tagline, 'Makes anvils.');
  assert.equal(context.company, 'Acme');
  assert.deepEqual(context.bullets[1], { text: 'Ran on-call rotation for the platform team', hidden: true, children: [] });
});

test('the block target sends the description as context only', () => {
  const { editable, context } = rewriteInput('experience', { ...experience, description: 'Old blurb' });
  assert.ok(!('description' in editable));
  assert.equal(context.description, 'Old blurb');
});

test('a bullet target edits one bullet, with a placeholder where it sits in the context', () => {
  const data = { ...experience, description: 'Old blurb' };
  const top = rewriteInput('experience', data, { kind: 'bullet', path: [0] });
  assert.deepEqual(top.editable, {
    bullet: { text: 'Built the deploy pipeline for all services', children: [{ text: 'Cut deploy time in half' }] },
  });
  assert.equal(top.context.description, 'Old blurb');
  assert.equal(top.context.tagline, 'Makes anvils.');
  assert.deepEqual(top.context.bullets[0], { text: '[the part being rewritten]' });
  assert.equal(top.context.bullets[1].text, 'Ran on-call rotation for the platform team');

  const sub = rewriteInput('experience', data, { kind: 'bullet', path: [0, 0] });
  assert.deepEqual(sub.editable, { bullet: { text: 'Cut deploy time in half' } });
  assert.deepEqual(sub.context.bullets[0], {
    text: 'Built the deploy pipeline for all services',
    children: [{ text: '[the part being rewritten]' }],
  });
});

test('a sub-bullet target under a hidden bullet is marked hidden', () => {
  const data = { bullets: [bullet('Hidden parent', { visibleWeb: false }, [bullet('Child')])] };
  const { editable } = rewriteInput('experience', data, { kind: 'bullet', path: [0, 0] });
  assert.deepEqual(editable, { bullet: { text: 'Child', hidden: true } });
});

test('a bullet rewrite writes only that bullet, keeping its flags and the other bullets as stored', () => {
  const data = { ...experience, bullets: ['Legacy string bullet', ...experience.bullets] };
  const rewrite = {
    bullet: { text: 'Led the on-call rotation', children: [] },
    tagline: 'Ignored',
  };
  const { data: merged, bulletReview } = mergeRewrite('experience', data, rewrite, { target: { kind: 'bullet', path: [2] } });
  assert.deepEqual(merged, {
    ...data,
    bullets: [data.bullets[0], data.bullets[1], { ...data.bullets[2], text: 'Led the on-call rotation' }],
  });
  assert.equal(merged.bullets[0], 'Legacy string bullet');
  assert.equal(merged.bullets[1], data.bullets[1]);
  assert.deepEqual(bulletReview, {
    items: [
      {
        depth: 0,
        before: 'Ran on-call rotation for the platform team',
        after: 'Led the on-call rotation',
        wasHidden: true,
        visibleWeb: true,
        visiblePrint: false,
      },
    ],
    removed: [],
  });
});

test('a bullet rewrite rewords its sub-bullets in place when restructuring is off', () => {
  const rewrite = { bullet: { text: 'Built the deploy pipeline', children: [{ text: 'Halved deploy time' }] } };
  const { data, bulletReview } = mergeRewrite('experience', experience, rewrite, { target: { kind: 'bullet', path: [0] } });
  assert.equal(data.bullets[0].text, 'Built the deploy pipeline');
  assert.equal(data.bullets[0].children[0].text, 'Halved deploy time');
  assert.equal(data.bullets[1], experience.bullets[1]);
  assert.deepEqual(bulletReview.items.map((i) => i.depth), [0, 1]);

  const extra = { bullet: { text: 'x', children: [{ text: 'a' }, { text: 'b' }] } };
  assert.throws(() => mergeRewrite('experience', experience, extra, { target: { kind: 'bullet', path: [0] } }), RewriteShapeError);
});

test('a bullet rewrite may restructure its sub-bullets, which inherit the bullet\'s visibility', () => {
  const data = {
    bullets: [bullet('Ran on-call', { visiblePrint: false }, [bullet('Wrote runbooks for every service'), bullet('Paged at night')])],
  };
  const rewrite = { bullet: { text: 'Led on-call', children: [{ text: 'Wrote runbooks for every service' }, { text: 'Trained new hires' }] } };
  const { data: merged, bulletReview } = mergeRewrite('experience', data, rewrite, {
    target: { kind: 'bullet', path: [0] },
    allowBulletRestructure: true,
  });
  const [top] = merged.bullets;
  assert.equal(top.visiblePrint, false);
  assert.deepEqual(top.children.map((c) => c.text), ['Wrote runbooks for every service', 'Trained new hires']);
  assert.equal(top.children[0].visiblePrint, false);
  // The new sub-bullet starts with the bullet's visibility, not visible everywhere.
  assert.deepEqual([top.children[1].visibleWeb, top.children[1].visiblePrint], [true, false]);
  assert.deepEqual(bulletReview.items.map((i) => [i.depth, i.before]), [[0, 'Ran on-call'], [1, 'Wrote runbooks for every service'], [1, null]]);
  assert.equal(bulletReview.items[2].visiblePrint, false);
  assert.deepEqual(bulletReview.removed, [{ depth: 1, before: 'Paged at night', wasHidden: true }]);
});

test('in a whole-block restructure, a new sub-bullet starts with its parent\'s visibility', () => {
  const data = { bullets: [bullet('Ran the on-call rotation', { visibleWeb: false }), bullet('Shipped the billing system')] };
  const rewrite = {
    tagline: '',
    bullets: [
      { text: 'Ran the on-call rotation', children: [{ text: 'Wrote runbooks' }] },
      { text: 'Shipped the billing system', children: [] },
      { text: 'Mentored two engineers', children: [] },
    ],
  };
  const { data: merged } = mergeRewrite('experience', data, rewrite, { allowBulletRestructure: true });
  const flags = (b) => [b.visibleWeb, b.visiblePrint];
  assert.deepEqual(flags(merged.bullets[0].children[0]), [false, true]);
  // A new top-level bullet still starts visible everywhere.
  assert.deepEqual(flags(merged.bullets[2]), [true, true]);
});

test('a sub-bullet rewrite writes only that sub-bullet', () => {
  const rewrite = { bullet: { text: 'Halved deploy time' } };
  const { data, bulletReview } = mergeRewrite('experience', experience, rewrite, { target: { kind: 'bullet', path: [0, 0] } });
  assert.deepEqual(data, {
    ...experience,
    bullets: [{ ...experience.bullets[0], children: [{ ...experience.bullets[0].children[0], text: 'Halved deploy time' }] }, experience.bullets[1]],
  });
  assert.deepEqual(bulletReview.items, [
    { depth: 1, before: 'Cut deploy time in half', after: 'Halved deploy time', wasHidden: false, visibleWeb: true, visiblePrint: true },
  ]);
  assert.throws(() => mergeRewrite('experience', experience, {}, { target: { kind: 'bullet', path: [0, 0] } }), RewriteShapeError);
});

test('an item target edits one custom item, with the others as context', () => {
  const data = {
    title: 'Certifications',
    items: [
      { heading: 'AWS', bodyType: 'text', text: 'Solutions Architect' },
      { heading: 'Languages', bodyType: 'tags', items: 'English, Spanish' },
    ],
  };
  const { editable, context } = rewriteInput('custom', data, { kind: 'item', index: 1 });
  assert.deepEqual(editable, { heading: 'Languages', body: 'English, Spanish' });
  assert.deepEqual(context, {
    title: 'Certifications',
    itemBodyType: 'tags',
    items: [
      { heading: 'AWS', body: 'Solutions Architect' },
      { heading: '', body: '[the part being rewritten]' },
    ],
  });

  const { data: merged } = mergeRewrite('custom', data, { heading: 'Languages', body: 'English (native), Spanish (fluent)', title: 'Ignored' }, {
    target: { kind: 'item', index: 1 },
  });
  assert.deepEqual(merged, { ...data, items: [data.items[0], { ...data.items[1], items: 'English (native), Spanish (fluent)' }] });
  assert.equal(merged.items[0], data.items[0]);
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
