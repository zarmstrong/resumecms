import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneBlockRows, slugify, uniqueSlug, validateName, validateSlug, MAX_SLUG_LENGTH } from './resumeFields.js';

const status = (fn) => {
  try {
    fn();
  } catch (err) {
    return err.status;
  }
  return null;
};

test('validateName trims and rejects empty, non-string and overlong names', () => {
  assert.equal(validateName('  Sales  '), 'Sales');
  for (const bad of [undefined, null, '', '   ', 42, {}]) assert.equal(status(() => validateName(bad)), 400, String(bad));
  assert.equal(status(() => validateName('x'.repeat(101))), 400);
});

test('validateSlug accepts lowercase kebab-case only', () => {
  for (const ok of ['main', 'sales-2026', 'a', '2026']) assert.equal(validateSlug(ok), ok);
  for (const bad of ['', 'Sales', 'sales_2026', 'sales.pdf', '-sales', 'sales-', 'sa--les', 'sales/x', 'sälës', 7, null]) {
    assert.equal(status(() => validateSlug(bad)), 400, String(bad));
  }
  assert.equal(status(() => validateSlug('a'.repeat(MAX_SLUG_LENGTH + 1))), 400);
});

test('slugify derives a valid slug from any name', () => {
  assert.equal(slugify('Sales — EMEA'), 'sales-emea');
  assert.equal(slugify('  Zoë’s Security Résumé '), 'zoe-s-security-resume');
  assert.equal(slugify('李明'), 'resume');
  assert.equal(slugify('!!!'), 'resume');
  const long = slugify(`${'word '.repeat(30)}end`);
  assert.ok(long.length <= MAX_SLUG_LENGTH);
  assert.equal(validateSlug(long), long);
});

test('uniqueSlug appends the first free number and keeps within the length limit', () => {
  const taken = new Set(['sales', 'sales-2']);
  assert.equal(uniqueSlug('ops', (s) => taken.has(s)), 'ops');
  assert.equal(uniqueSlug('sales', (s) => taken.has(s)), 'sales-3');
  const base = 'a'.repeat(MAX_SLUG_LENGTH);
  const next = uniqueSlug(base, (s) => s === base);
  assert.equal(next, `${'a'.repeat(MAX_SLUG_LENGTH - 2)}-2`);
  assert.equal(validateSlug(next), next);
});

test('cloneBlockRows gives every block a new id and remaps nesting', () => {
  const rows = [
    { id: 'h', resume_id: 'src', parent_id: null, type: 'heading', position: 0, data: '{}', created_at: 'old', updated_at: 'old' },
    { id: 'e', resume_id: 'src', parent_id: 'h', type: 'experience', position: 0, data: '{"a":1}', created_at: 'old', updated_at: 'old' },
    { id: 'x', resume_id: 'src', parent_id: 'gone', type: 'custom', position: 1, data: '{}', created_at: 'old', updated_at: 'old' },
  ];
  let n = 0;
  const copies = cloneBlockRows(rows, 'dst', 'now', () => `new-${++n}`);
  assert.deepEqual(
    copies.map((r) => [r.id, r.resume_id, r.parent_id, r.type, r.position, r.data, r.created_at]),
    [
      ['new-1', 'dst', null, 'heading', 0, '{}', 'now'],
      ['new-2', 'dst', 'new-1', 'experience', 0, '{"a":1}', 'now'],
      ['new-3', 'dst', null, 'custom', 1, '{}', 'now'],
    ]
  );
  assert.equal(rows[1].parent_id, 'h', 'the source rows are untouched');
});
