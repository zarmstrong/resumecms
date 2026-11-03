import test from 'node:test';
import assert from 'node:assert/strict';
import { AiSettingsError, applyAiSettingsUpdate, normalizeAiSettings, publicAiSettings } from './aiSettings.js';

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
  assert.equal(pub.tense, 'auto');
  // In display order, each with the label the editor shows.
  assert.deepEqual(Object.keys(pub.tenses), ['auto', 'past', 'present', 'byRole']);
  for (const { label } of Object.values(pub.tenses)) assert.equal(typeof label, 'string');
  assert.equal(pub.models.anthropic, 'claude-opus-5-5');
  assert.equal(pub.timeoutSeconds, 60);
});

test('timeout accepts whole seconds from 20 to 120 only', () => {
  assert.equal(applyAiSettingsUpdate({}, { timeoutSeconds: 20 }).settings.timeoutSeconds, 20);
  assert.equal(applyAiSettingsUpdate({}, { timeoutSeconds: 120 }).settings.timeoutSeconds, 120);
  for (const bad of [19, 121, 30.5, '60', null, 0]) {
    assert.throws(() => applyAiSettingsUpdate({}, { timeoutSeconds: bad }), AiSettingsError);
  }
  // A bad stored value (hand-edited DB) falls back to the default.
  assert.equal(normalizeAiSettings({ timeoutSeconds: 5 }).timeoutSeconds, 60);
});

test('the custom-block tense picker gets its options and default from the setting', () => {
  assert.deepEqual(Object.keys(publicAiSettings({}).pickedTenses), ['auto', 'past', 'present']);
  assert.deepEqual(publicAiSettings({}).pickedTenseTypes, ['custom']);
  const defaults = { auto: 'auto', past: 'past', present: 'present', byRole: 'auto' };
  for (const [tense, expected] of Object.entries(defaults)) {
    assert.equal(publicAiSettings({ tense }).pickedTenseDefault, expected, tense);
    assert.ok(Object.hasOwn(publicAiSettings({}).pickedTenses, expected));
  }
});

test('tense accepts only the known values and a bad stored value falls back to auto', () => {
  for (const tense of ['auto', 'past', 'present', 'byRole']) {
    assert.equal(applyAiSettingsUpdate({}, { tense }).settings.tense, tense);
  }
  for (const bad of ['future', 'Past', 1, null, '', true, 'constructor', '__proto__']) {
    assert.throws(() => applyAiSettingsUpdate({}, { tense: bad }), AiSettingsError, JSON.stringify(bad));
  }
  // Omitting it keeps the stored value.
  assert.equal(applyAiSettingsUpdate({ tense: 'past' }, { enabled: true }).settings.tense, 'past');
  assert.equal(normalizeAiSettings({ tense: 'bogus' }).tense, 'auto');
  assert.equal(normalizeAiSettings({ tense: 'toString' }).tense, 'auto');
  assert.equal(normalizeAiSettings({}).tense, 'auto');
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

test('inherited object names are not providers', () => {
  const base = normalizeAiSettings({});
  for (const id of ['constructor', 'toString', '__proto__']) {
    assert.throws(() => applyAiSettingsUpdate(base, { provider: id }), AiSettingsError);
    assert.throws(() => applyAiSettingsUpdate(base, { removeKeys: [id] }), AiSettingsError);
  }
  assert.throws(() => applyAiSettingsUpdate(base, JSON.parse('{"models":{"__proto__":"x"}}')), AiSettingsError);
  assert.throws(() => applyAiSettingsUpdate(base, { apiKeys: { constructor: 'sk-abcdefghijkl' } }), AiSettingsError);
  assert.equal(normalizeAiSettings({ provider: 'constructor' }).provider, 'anthropic');
});
