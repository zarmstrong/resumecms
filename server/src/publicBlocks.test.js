import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksForMode } from './publicBlocks.js';

const block = (id, type, overrides = {}) => ({
  id, type, position: 0, parentId: null, visibleWeb: true, visiblePrint: true, data: {}, ...overrides,
});

test('visible blocks pass through with their data', () => {
  const blocks = [block('h1', 'heading', { data: { title: 'Work', column: 'secondary' } })];
  assert.deepEqual(blocksForMode(blocks, 'web'), blocks);
});

test('a hidden block becomes a content-free placeholder in the same position', () => {
  const blocks = [
    block('h1', 'heading', { visibleWeb: false, data: { title: 'Secret', column: 'secondary' } }),
    block('exp', 'experience', { parentId: 'h1', data: { company: 'Acme', bullets: ['did things'] } }),
    block('h2', 'heading', { data: { title: 'Education' } }),
  ];
  const out = blocksForMode(blocks, 'web');
  assert.deepEqual(out.map((b) => b.id), ['h1', 'exp', 'h2']);
  assert.deepEqual(out[0], {
    id: 'h1', type: 'heading', position: 0, parentId: null,
    visibleWeb: false, visiblePrint: true, hidden: true, data: { column: 'secondary' },
  });
  assert.equal(out[1].hidden, undefined);
  assert.equal(out[1].data.company, 'Acme');
});

test('placeholders for non-heading blocks carry no data at all', () => {
  const blocks = [block('note', 'custom', { visiblePrint: false, data: { html: '<p>private</p>', column: 'primary' } })];
  const [out] = blocksForMode(blocks, 'print');
  assert.equal(out.hidden, true);
  assert.deepEqual(out.data, {});
  assert.ok(!JSON.stringify(out).includes('private'));
});

test('web and print modes each consult their own flag', () => {
  const blocks = [block('a', 'summary', { visibleWeb: false, visiblePrint: true, data: { text: 'hi' } })];
  assert.equal(blocksForMode(blocks, 'web')[0].hidden, true);
  assert.equal(blocksForMode(blocks, 'print')[0].hidden, undefined);
});

test('experience bullets are filtered per mode, recursively, and legacy string bullets survive', () => {
  const blocks = [block('exp', 'experience', {
    data: {
      bullets: [
        'legacy',
        { text: 'web only', visiblePrint: false, children: [{ text: 'kid' }, { text: 'hidden kid', visibleWeb: false }] },
        { text: 'print only', visibleWeb: false },
      ],
    },
  })];
  assert.deepEqual(blocksForMode(blocks, 'web')[0].data.bullets, [
    { text: 'legacy', children: [] },
    { text: 'web only', children: [{ text: 'kid', children: [] }] },
  ]);
  assert.deepEqual(blocksForMode(blocks, 'print')[0].data.bullets, [
    { text: 'legacy', children: [] },
    { text: 'print only', children: [] },
  ]);
});

test('tolerates a missing block list', () => {
  assert.deepEqual(blocksForMode(undefined, 'web'), []);
});
