import test from 'node:test';
import assert from 'node:assert/strict';
import { blocksForMode } from './publicBlocks.js';

const DETAILS = {
  hoursPerWeek: '40', grade: 'GS-0343-11', salary: '$85,000 per year', supervisor: 'Jane Doe, (555) 555-0100', contactSupervisor: 'yes',
};
const detailKeys = Object.keys(DETAILS);
const experience = (data = {}) => block('exp', 'experience', { data: { jobTitle: 'Analyst', bullets: [], ...DETAILS, ...data } });

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

test('federal details are kept by default, in both modes', () => {
  assert.deepEqual(blocksForMode([experience()], 'web')[0].data, experience().data);
  assert.deepEqual(blocksForMode([experience()], 'print')[0].data, experience().data);
});

test('detailsVisibleWeb false drops every detail key from the web snapshot and keeps them on print', () => {
  const blocks = [experience({ detailsVisibleWeb: false })];
  const web = blocksForMode(blocks, 'web')[0].data;
  for (const key of detailKeys) assert.equal(key in web, false, key);
  assert.ok(!JSON.stringify(blocksForMode(blocks, 'web')).includes('Jane Doe'));
  assert.deepEqual(blocksForMode(blocks, 'print')[0].data, experience({ detailsVisibleWeb: false }).data);
  assert.equal(blocksForMode(blocks, 'print')[0].data.supervisor, 'Jane Doe, (555) 555-0100');
});

test('detailsVisiblePrint false drops every detail key from the print snapshot and keeps them on web', () => {
  const blocks = [experience({ detailsVisiblePrint: false })];
  const print = blocksForMode(blocks, 'print')[0].data;
  for (const key of detailKeys) assert.equal(key in print, false, key);
  assert.ok(!JSON.stringify(blocksForMode(blocks, 'print')).includes('Jane Doe'));
  assert.equal(blocksForMode(blocks, 'web')[0].data.supervisor, 'Jane Doe, (555) 555-0100');
});

test('the detail flags leave the other experience data untouched', () => {
  const [out] = blocksForMode([experience({
    detailsVisibleWeb: false, detailsVisiblePrint: false, bullets: [{ text: 'kept' }, { text: 'hidden', visibleWeb: false }],
  })], 'web');
  assert.equal(out.data.jobTitle, 'Analyst');
  assert.deepEqual(out.data.bullets, [{ text: 'kept', children: [] }]);
});

test('a non-experience block keeps its own data whatever its detail-looking keys say', () => {
  const blocks = [block('sum', 'summary', { data: { text: 'hi', supervisor: 'Jane Doe', hoursPerWeek: '40', detailsVisibleWeb: false } })];
  assert.deepEqual(blocksForMode(blocks, 'web'), blocks);
});

test('tolerates a missing block list', () => {
  assert.deepEqual(blocksForMode(undefined, 'web'), []);
});
