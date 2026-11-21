import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySkillsEducationAuto } from './sidebarPanel.js';

test('credentials share the education rail unless the section contains main content', () => {
  const group = (...types) => ({ blocks: ['heading', ...types].map((type) => ({ type })) });
  assert.equal(classifySkillsEducationAuto(group('credentials')), 'secondary');
  assert.equal(classifySkillsEducationAuto(group('credentials', 'education')), 'secondary');
  assert.equal(classifySkillsEducationAuto(group('credentials', 'experience')), 'primary');
});

test('languages share the education rail unless the section contains main content', () => {
  const group = (...types) => ({ blocks: ['heading', ...types].map((type) => ({ type })) });
  assert.equal(classifySkillsEducationAuto(group('languages')), 'secondary');
  assert.equal(classifySkillsEducationAuto(group('languages', 'experience')), 'primary');
});
