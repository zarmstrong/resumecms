// AI provider settings live in the `settings` table under `ai`, alongside
// credentials and TOTP — not in env vars — so they can be changed from the
// editor without a restart. They're never part of the published snapshot
// (publish.js only copies header/site/blocks) and Discard draft doesn't
// touch them.
//
// API keys are stored in plain text, like the TOTP secret: anyone with a
// copy of the SQLite file has them. They are write-only over the API —
// publicAiSettings() is the only shape that ever leaves the server.

import { AI_TENSES, DEFAULT_TENSE, PICKED_TENSES, PICKED_TENSE_TYPES, defaultPickedTense, isAiTense } from './tense.js';
import { BRIEF_LIMITS } from './brief.js';

export const AI_PROVIDERS = {
  anthropic: { label: 'Claude (Anthropic)', defaultModel: 'claude-opus-5-5' },
  openai: { label: 'ChatGPT (OpenAI)', defaultModel: 'gpt-5.6' },
};

const MODEL_PATTERN = /^[A-Za-z0-9._:/-]{1,100}$/;

// How long one rewrite may take before the server gives up on the provider,
// retries included. The floor leaves room for a slow model; the ceiling stops
// a hung request from tying up the editor (and a reverse proxy) for minutes.
export const AI_TIMEOUT_SECONDS = { min: 20, max: 120, default: 60 };
const MAX_KEY_LENGTH = 500;

export class AiSettingsError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

// Own-property check, so inherited names like `constructor` or `__proto__`
// don't pass as providers.
const isValidTimeout = (n) =>
  Number.isInteger(n) && n >= AI_TIMEOUT_SECONDS.min && n <= AI_TIMEOUT_SECONDS.max;

export const isAiProvider = (id) => typeof id === 'string' && Object.hasOwn(AI_PROVIDERS, id);

export function normalizeAiSettings(stored) {
  const s = stored || {};
  const models = {};
  for (const [id, { defaultModel }] of Object.entries(AI_PROVIDERS)) {
    models[id] = s.models?.[id] || defaultModel;
  }
  return {
    enabled: s.enabled === true,
    provider: isAiProvider(s.provider) ? s.provider : 'anthropic',
    models,
    allowBulletRestructure: s.allowBulletRestructure === true,
    tense: isAiTense(s.tense) ? s.tense : DEFAULT_TENSE,
    timeoutSeconds: isValidTimeout(s.timeoutSeconds) ? s.timeoutSeconds : AI_TIMEOUT_SECONDS.default,
    apiKeys: { ...(s.apiKeys || {}) },
  };
}

// `{ id: { label } }` for each option, and nothing else an option might carry.
const labelsOf = (options) => Object.fromEntries(Object.entries(options).map(([id, { label }]) => [id, { label }]));

function keyHint(key) {
  return key.length > 8 ? `…${key.slice(-4)}` : '…';
}

export function publicAiSettings(stored) {
  const s = normalizeAiSettings(stored);
  const keys = {};
  for (const id of Object.keys(AI_PROVIDERS)) {
    const key = s.apiKeys[id];
    keys[id] = key ? { hasKey: true, hint: keyHint(key) } : { hasKey: false, hint: null };
  }
  return {
    enabled: s.enabled,
    provider: s.provider,
    models: s.models,
    allowBulletRestructure: s.allowBulletRestructure,
    tense: s.tense,
    // The tense options (tense.js) as the editor renders them.
    tenses: labelsOf(AI_TENSES),
    pickedTenses: labelsOf(PICKED_TENSES),
    pickedTenseDefault: defaultPickedTense(s.tense),
    pickedTenseTypes: [...PICKED_TENSE_TYPES],
    timeoutSeconds: s.timeoutSeconds,
    timeoutRange: { min: AI_TIMEOUT_SECONDS.min, max: AI_TIMEOUT_SECONDS.max },
    // A tailoring brief's caps (brief.js), for the editor's form.
    briefLimits: { ...BRIEF_LIMITS },
    keys,
    providers: Object.fromEntries(
      Object.entries(AI_PROVIDERS).map(([id, p]) => [id, { label: p.label, defaultModel: p.defaultModel }])
    ),
    // What the editor actually needs to decide whether to show Rewrite.
    available: s.enabled && Boolean(s.apiKeys[s.provider]),
  };
}

// Validates a PUT /api/ai/settings body against the stored settings and
// returns the settings to save. `keysChanged` tells the route whether the
// update adds or removes an API key, which requires the current password.
export function applyAiSettingsUpdate(stored, body) {
  const current = normalizeAiSettings(stored);
  const next = { ...current, models: { ...current.models }, apiKeys: { ...current.apiKeys } };
  const b = body || {};
  let keysChanged = false;

  if (b.enabled !== undefined) {
    if (typeof b.enabled !== 'boolean') throw new AiSettingsError('enabled must be a boolean');
    next.enabled = b.enabled;
  }
  if (b.allowBulletRestructure !== undefined) {
    if (typeof b.allowBulletRestructure !== 'boolean') {
      throw new AiSettingsError('allowBulletRestructure must be a boolean');
    }
    next.allowBulletRestructure = b.allowBulletRestructure;
  }
  if (b.tense !== undefined) {
    if (!isAiTense(b.tense)) throw new AiSettingsError(`tense must be one of ${Object.keys(AI_TENSES).join(', ')}`);
    next.tense = b.tense;
  }
  if (b.timeoutSeconds !== undefined) {
    if (!isValidTimeout(b.timeoutSeconds)) {
      throw new AiSettingsError(
        `The timeout must be a whole number of seconds from ${AI_TIMEOUT_SECONDS.min} to ${AI_TIMEOUT_SECONDS.max}`
      );
    }
    next.timeoutSeconds = b.timeoutSeconds;
  }
  if (b.provider !== undefined) {
    if (!isAiProvider(b.provider)) throw new AiSettingsError('Unknown AI provider');
    next.provider = b.provider;
  }
  if (b.models !== undefined) {
    if (!b.models || typeof b.models !== 'object') throw new AiSettingsError('models must be an object');
    for (const [id, model] of Object.entries(b.models)) {
      if (!isAiProvider(id)) throw new AiSettingsError(`Unknown AI provider: ${id}`);
      const trimmed = typeof model === 'string' ? model.trim() : '';
      // Blank resets to the provider's default rather than saving nothing.
      if (trimmed === '') next.models[id] = AI_PROVIDERS[id].defaultModel;
      else if (!MODEL_PATTERN.test(trimmed)) throw new AiSettingsError(`Invalid model name for ${AI_PROVIDERS[id].label}`);
      else next.models[id] = trimmed;
    }
  }
  if (b.apiKeys !== undefined) {
    if (!b.apiKeys || typeof b.apiKeys !== 'object') throw new AiSettingsError('apiKeys must be an object');
    for (const [id, key] of Object.entries(b.apiKeys)) {
      if (!isAiProvider(id)) throw new AiSettingsError(`Unknown AI provider: ${id}`);
      const trimmed = typeof key === 'string' ? key.trim() : '';
      // A blank field means "keep the current key", so the form can always
      // send it without having to know the key it can't see.
      if (trimmed === '') continue;
      if (trimmed.length > MAX_KEY_LENGTH || /\s/.test(trimmed)) {
        throw new AiSettingsError(`That doesn't look like a valid ${AI_PROVIDERS[id].label} API key`);
      }
      next.apiKeys[id] = trimmed;
      keysChanged = true;
    }
  }
  if (b.removeKeys !== undefined) {
    if (!Array.isArray(b.removeKeys)) throw new AiSettingsError('removeKeys must be an array');
    for (const id of b.removeKeys) {
      if (!isAiProvider(id)) throw new AiSettingsError(`Unknown AI provider: ${id}`);
      if (next.apiKeys[id]) {
        delete next.apiKeys[id];
        keysChanged = true;
      }
    }
  }
  return { settings: next, keysChanged };
}
