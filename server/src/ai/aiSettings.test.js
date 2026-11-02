import test from 'node:test';
import assert from 'node:assert/strict';
import { AiSettingsError, applyAiSettingsUpdate, publicAiSettings } from './aiSettings.js';

test('public settings never include the API key itself', () => {
  const pub = publicAiSettings({ enabled: true, provider: 'anthropic', apiKeys: { anthropic: 'sk-ant-abcdefghijkl1234' } });
  assert.ok(!JSON.stringify(pub).includes('abcdefghijkl'));
  assert.deepEqual(pub.keys.anthropic, { hasKey: true, hint: '…1234' });
  assert.equal(pub.keys.openai.hasKey, false);
  assert.equal(pub.available, true);
});

test('available needs both enabled and a key for the selected provider', () => {
  assert.equal(publicAiSettings({ enabled: true, provider: 'openai', apiKeys: { anthropic: 'k' } }).available, false);
  assert.equal(publicAiSettings({ enabled: false, provider: 'anthropic', apiKeys: { anthropic: 'k' } }).available, false);
});

test('defaults: disabled, Claude, bullet restructuring off', () => {
  const pub = publicAiSettings(null);
  assert.equal(pub.enabled, false);
  assert.equal(pub.provider, 'anthropic');
  assert.equal(pub.allowBulletRestructure, false);
  assert.equal(pub.models.anthropic, 'claude-opus-5-5');
});

test('a blank key keeps the stored one and does not count as a key change', () => {
  const stored = { apiKeys: { anthropic: 'old-key' } };
  const { settings, keysChanged } = applyAiSettingsUpdate(stored, { apiKeys: { anthropic: '  ' }, enabled: true });
  assert.equal(settings.apiKeys.anthropic, 'old-key');
  assert.equal(keysChanged, false);
});

test('setting or removing a key is flagged so the route can require the password', () => {
  assert.equal(applyAiSettingsUpdate({}, { apiKeys: { openai: 'sk-new' } }).keysChanged, true);
  const removed = applyAiSettingsUpdate({ apiKeys: { openai: 'sk' } }, { removeKeys: ['openai'] });
  assert.equal(removed.keysChanged, true);
  assert.ok(!('openai' in removed.settings.apiKeys));
  assert.equal(applyAiSettingsUpdate({}, { removeKeys: ['openai'] }).keysChanged, false);
});

test('switching providers keeps the other provider\'s key and model', () => {
  const stored = { provider: 'anthropic', apiKeys: { anthropic: 'a', openai: 'o' }, models: { openai: 'my-model' } };
  const { settings } = applyAiSettingsUpdate(stored, { provider: 'openai' });
  assert.deepEqual(settings.apiKeys, { anthropic: 'a', openai: 'o' });
  assert.equal(settings.models.openai, 'my-model');
});

test('a blank model resets to the provider default', () => {
  const { settings } = applyAiSettingsUpdate({ models: { anthropic: 'x' } }, { models: { anthropic: '' } });
  assert.equal(settings.models.anthropic, 'claude-opus-5-5');
});

test('rejects bad input', () => {
  assert.throws(() => applyAiSettingsUpdate({}, { provider: 'gemini' }), AiSettingsError);
  assert.throws(() => applyAiSettingsUpdate({}, { enabled: 'yes' }), AiSettingsError);
  assert.throws(() => applyAiSettingsUpdate({}, { models: { anthropic: 'has spaces' } }), AiSettingsError);
  assert.throws(() => applyAiSettingsUpdate({}, { apiKeys: { anthropic: 'has space' } }), AiSettingsError);
  assert.throws(() => applyAiSettingsUpdate({}, { allowBulletRestructure: 1 }), AiSettingsError);
});
