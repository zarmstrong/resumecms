import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockWrapperStyle,
  blockWrapperClassName,
  BLOCK_SPACING_OPTIONS,
  BLOCK_ALIGN_OPTIONS,
  ALIGNABLE_TYPES,
} from './blockStyle.js';

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

// A highlighted wrapper's padding is also the box's inset, so the preset is
// added to it rather than replacing it, and the box is pulled in by as much.
test('a spacing preset on a highlighted block pads outside its box', () => {
  assert.deepEqual(blockWrapperStyle({ style: { highlight: true, spaceAbove: 'small', spaceBelow: 'none' } }), {
    paddingTop: 'calc(12px + var(--r-highlight-pad-y))',
    '--r-highlight-above': '12px',
    '--r-block-space-above': '0px',
    paddingBottom: 'calc(0px + var(--r-highlight-pad-y))',
    '--r-highlight-below': '0px',
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

test('an alignment value maps to its class on the alignable block types', () => {
  for (const type of ALIGNABLE_TYPES) {
    assert.equal(blockWrapperClassName({ style: { align: 'center' } }, type), ' r-align-center', type);
  }
  assert.equal(blockWrapperClassName({ style: { align: 'left' } }, 'summary'), ' r-align-left');
  assert.equal(blockWrapperClassName({ style: { align: 'right' } }, 'custom'), ' r-align-right');
  assert.equal(
    blockWrapperClassName({ style: { align: 'center', highlight: true } }, 'custom'),
    ' r-align-center r-block-highlight',
  );
  // Alignment is a class, not an inline style: resume.css needs it to reach
  // chip rows, lists, and template heading rules.
  assert.deepEqual(blockWrapperStyle({ style: { align: 'center' } }), {});
});

// The store accepts any string here (and MCP callers can send anything),
// so the renderer has to shrug off junk rather than emit a stray class.
test('unknown or default alignment values add nothing', () => {
  for (const align of ['', 'middle', 'justify', 'CENTER', 42, null, undefined, { x: 1 }]) {
    assert.equal(blockWrapperClassName({ style: { align } }, 'custom'), '', String(align));
  }
});

test('experience and education ignore a stored alignment', () => {
  assert.equal(blockWrapperClassName({ style: { align: 'center' } }, 'experience'), '');
  assert.equal(blockWrapperClassName({ style: { align: 'center' } }, 'education'), '');
  assert.equal(blockWrapperClassName({ style: { align: 'center' } }), '');
});

test('every non-default alignment option resolves to a class', () => {
  for (const { value } of BLOCK_ALIGN_OPTIONS) {
    if (!value) continue;
    assert.equal(blockWrapperClassName({ style: { align: value } }, 'summary'), ` r-align-${value}`);
  }
});
