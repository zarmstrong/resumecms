import { useEffect, useState } from 'react';
import { api } from '../api.js';

// The AI section of Account Settings. Self-contained like TotpSettings: it
// has its own Save, separate from the modal's username/password Save.
//
// API keys are write-only — the server only ever returns whether a key is
// set plus its last four characters — so the key field always starts blank
// and a blank field on save keeps the stored key.
export function AiSettings({ onChange, onDirtyChange }) {
  const [ai, setAi] = useState(null);
  const [form, setForm] = useState(null);
  const [newKey, setNewKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  function load(next) {
    setAi(next);
    setForm({
      enabled: next.enabled,
      provider: next.provider,
      models: { ...next.models },
      allowBulletRestructure: next.allowBulletRestructure,
      // Kept as the input's string so a half-typed value doesn't jump around.
      timeoutSeconds: String(next.timeoutSeconds),
    });
    setNewKey('');
    setRemoveKey(false);
    setCurrentPassword('');
  }

  useEffect(() => {
    api
      .getAiSettings()
      .then(({ ai: loaded }) => load(loaded))
      .catch((err) => setError(`Couldn't load AI settings: ${err.message}`));
  }, []);

  const dirty = Boolean(
    form &&
      (newKey.trim() !== '' ||
        removeKey ||
        form.enabled !== ai.enabled ||
        form.provider !== ai.provider ||
        form.allowBulletRestructure !== ai.allowBulletRestructure ||
        Number(form.timeoutSeconds) !== ai.timeoutSeconds ||
        // A blank model saves as the provider's default, so it only counts
        // as a change when the stored model isn't already the default.
        Object.keys(ai.models).some(
          (id) => ((form.models[id] || '').trim() || ai.providers[id].defaultModel) !== ai.models[id]
        ))
  );
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  if (!form) return error ? <div className="ed-login-error">{error}</div> : null;

  const keyInfo = ai.keys[form.provider];
  const changingKey = newKey.trim() !== '' || removeKey;

  function patch(p) {
    setForm((f) => ({ ...f, ...p }));
    setSaved(false);
  }

  function selectProvider(provider) {
    // A typed key belongs to the provider it was typed for.
    setNewKey('');
    setRemoveKey(false);
    patch({ provider });
  }

  async function handleSave() {
    setError(null);
    if (changingKey && !currentPassword) {
      setError('Enter your current password to add or remove an API key.');
      return;
    }
    setBusy(true);
    try {
      const { ai: next } = await api.updateAiSettings({
        ...form,
        timeoutSeconds: Number(form.timeoutSeconds),
        apiKeys: newKey.trim() ? { [form.provider]: newKey } : undefined,
        removeKeys: removeKey ? [form.provider] : undefined,
        currentPassword: changingKey ? currentPassword : undefined,
      });
      load(next);
      onChange?.(next);
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-form">
      <label className="ed-field ed-checkbox-field">
        <input type="checkbox" checked={form.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        Enable AI rewrites in the editor
      </label>

      <div className="ed-field">
        <label htmlFor="ed-ai-provider">Provider</label>
        <select
          id="ed-ai-provider"
          className="ed-input"
          value={form.provider}
          onChange={(e) => selectProvider(e.target.value)}
        >
          {Object.entries(ai.providers).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
              {ai.keys[id].hasKey ? '' : ' — no key'}
            </option>
          ))}
        </select>
      </div>

      <div className="ed-field">
        <label htmlFor="ed-ai-model">Model</label>
        <input
          id="ed-ai-model"
          className="ed-input"
          value={form.models[form.provider] || ''}
          onChange={(e) => patch({ models: { ...form.models, [form.provider]: e.target.value } })}
          placeholder={`Leave blank for the default (${ai.providers[form.provider].defaultModel})`}
        />
      </div>

      <div className="ed-field">
        <label htmlFor="ed-ai-key">API key</label>
        {removeKey ? (
          <div className="ed-ai-key-row">
            <span className="ed-field-hint">The saved key will be removed when you save.</span>
            <button type="button" className="ed-btn ed-btn-ghost" onClick={() => setRemoveKey(false)}>
              Undo
            </button>
          </div>
        ) : (
          <div className="ed-ai-key-row">
            <input
              id="ed-ai-key"
              type="password"
              autoComplete="off"
              className="ed-input ed-input-flex"
              value={newKey}
              onChange={(e) => {
                setNewKey(e.target.value);
                setSaved(false);
              }}
              placeholder={keyInfo.hasKey ? `Saved (${keyInfo.hint}) — leave blank to keep` : 'Paste an API key'}
            />
            {keyInfo.hasKey && (
              <button type="button" className="ed-btn ed-btn-ghost" onClick={() => setRemoveKey(true)}>
                Remove
              </button>
            )}
          </div>
        )}
        <span className="ed-field-hint">
          Stored in this site's database and never shown again. The selected blocks' text is sent to the provider
          when you rewrite, including bullets hidden from web or print; your header and contact details are not.
        </span>
      </div>

      <label className="ed-field ed-checkbox-field">
        <input
          type="checkbox"
          checked={form.allowBulletRestructure}
          onChange={(e) => patch({ allowBulletRestructure: e.target.checked })}
        />
        Let AI add, remove, or merge bullets
      </label>
      <span className="ed-field-hint">
        Off: the AI only rewords existing bullets. On: it can restructure them; each bullet keeps the web/print
        visibility of the original it most resembles, and new bullets start visible everywhere.
      </span>

      <div className="ed-field">
        <label htmlFor="ed-ai-timeout">Timeout (seconds)</label>
        <input
          id="ed-ai-timeout"
          type="number"
          className="ed-input"
          min={ai.timeoutRange.min}
          max={ai.timeoutRange.max}
          step={1}
          value={form.timeoutSeconds}
          onChange={(e) => patch({ timeoutSeconds: e.target.value })}
        />
        <span className="ed-field-hint">
          How long to wait for the AI before giving up, from {ai.timeoutRange.min} to {ai.timeoutRange.max} seconds.
        </span>
      </div>

      {changingKey && (
        <div className="ed-field">
          <label htmlFor="ed-ai-password">Current password</label>
          <input
            id="ed-ai-password"
            type="password"
            autoComplete="current-password"
            className="ed-input"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Required to change the API key"
          />
        </div>
      )}

      {error && <div className="ed-login-error">{error}</div>}

      <div className="ed-ai-settings-actions">
        {saved && <span className="ed-field-hint">Saved</span>}
        <button type="button" className="ed-btn ed-btn-primary" onClick={handleSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save AI settings'}
        </button>
      </div>
    </div>
  );
}
