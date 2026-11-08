import test from 'node:test';
import assert from 'node:assert/strict';
import { assertBlockData, BLOCK_DATA_VALIDATORS } from './blockData.js';
import { BLOCK_DATA_SCHEMAS } from './mcp/blockSchemas.js';
import { BLOCK_TYPES } from './resumeStore.js';

test('every block type has a validator, and every documented key is known to it', () => {
  for (const type of BLOCK_TYPES) {
    assert.ok(BLOCK_DATA_VALIDATORS[type], `${type} has no validator`);
    const documented = Object.keys(BLOCK_DATA_SCHEMAS[type].properties);
    const known = Object.keys(BLOCK_DATA_VALIDATORS[type].shape);
    assert.deepEqual(documented.filter((k) => !known.includes(k)), [], `${type}: documented keys missing from the validator`);
    assert.deepEqual(known.filter((k) => !documented.includes(k)), [], `${type}: validator keys missing from the docs`);
  }
});

test('well-formed data passes, including the documented examples, extras, and string bullets', () => {
  for (const type of BLOCK_TYPES) assertBlockData(type, BLOCK_DATA_SCHEMAS[type].example);
  assertBlockData('experience', { jobTitle: 'X', bullets: ['one', { text: 'two', children: ['a', { text: 'b' }] }], extra: 1 });
  assertBlockData('heading', { text: 'H', style: { highlight: true, spaceAbove: 'large', align: 'center' } });
  assertBlockData('custom', { title: 'T', items: [{ heading: 'h', bodyType: 'tags', items: 'a, b' }] });
  assertBlockData('summary', {});
  assertBlockData('education', { degree: null });
});

test('a key of the wrong kind is a 400 that names it', () => {
  const fail = (type, data, re) => assert.throws(() => assertBlockData(type, data), (e) => e.status === 400 && re.test(e.message), `${type} ${JSON.stringify(data)}`);
  fail('experience', { bullets: 'not a list' }, /^data\.bullets: /);
  fail('experience', { bullets: [{ text: 1 }] }, /^data\.bullets\.0/);
  fail('experience', { bullets: [{ children: 'x' }] }, /^data\.bullets\.0\.children/);
  fail('custom', { items: { heading: 'h' } }, /^data\.items: /);
  fail('custom', { items: [{ url: 5 }] }, /^data\.items\.0\.url/);
  fail('skills_group', { items: ['Go', 'Python'] }, /^data\.items: /);
  fail('heading', { style: { highlight: 'yes' } }, /^data\.style\.highlight/);
  fail('custom', { style: { align: true } }, /^data\.style\.align/);
  fail('summary', { text: { rich: true } }, /^data\.text: /);
  assert.throws(() => assertBlockData('poem', {}), (e) => e.status === 400 && /unknown block type/.test(e.message));
});
