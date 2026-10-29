import test from 'node:test';
import assert from 'node:assert/strict';
import { blockWrapperStyle, blockWrapperClassName, BLOCK_SPACING_OPTIONS } from './blockStyle.js';

test('unset spacing leaves the wrapper alone', () => {
  assert.deepEqual(blockWrapperStyle({}), {});
  assert.equal(blockWrapperClassName({}), '');
  assert.equal(blockWrapperClassName({ style: { spaceAbove: '', spaceBelow: '' } }), '');
});

test('a spacing preset pads its side and zeroes the block’s own margin there', () => {
  assert.deepEqual(blockWrapperStyle({ style: { spaceAbove: 'small' } }), {
    paddingTop: '12px',
    '--r-block-space-above': '0px',
  });
  assert.deepEqual(blockWrapperStyle({ style: { spaceBelow: 'none' } }), {
    paddingBottom: '0px',
    '--r-block-space-below': '0px',
  });
});

// resume.css keys off these classes to drop the neighbor's facing margin,
// so the preset is the whole gap instead of stacking on top of it.
test('a spacing preset marks the wrapper so the neighbor’s margin is dropped', () => {
  assert.equal(blockWrapperClassName({ style: { spaceAbove: 'xsmall' } }), ' r-block-space-above-set');
  assert.equal(blockWrapperClassName({ style: { spaceBelow: 'large' } }), ' r-block-space-below-set');
  assert.equal(
    blockWrapperClassName({ style: { highlight: true, spaceAbove: 'none', spaceBelow: 'medium' } }),
    ' r-block-highlight r-block-space-above-set r-block-space-below-set',
  );
  assert.equal(blockWrapperClassName({ style: { spaceAbove: 'bogus' } }), '');
});

test('every non-default option resolves to a preset', () => {
  for (const { value } of BLOCK_SPACING_OPTIONS) {
    if (!value) continue;
    assert.ok(blockWrapperStyle({ style: { spaceAbove: value } }).paddingTop, value);
  }
});
