import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function TotpSettings() {
  const [enabled, setEnabled] = useState(null);
  const [pending, setPending] = useState(null); // { secret, qrDataUrl } while enrolling
  const [token, setToken] = useState('');
  // Turning 2FA on needs the password; while it's on, replacing or
  // disabling it needs the password and a code from the current app. The
  // server checks both.
  const [currentPassword, setCurrentPassword] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getTotpStatus().then((s) => setEnabled(s.enabled));
  }, []);

  function clearFactorFields() {
    setCurrentPassword('');
    setCurrentCode('');
  }

  async function handleEnable() {
    if (enabled && (!currentPassword || !currentCode)) {
      setError('Enter your current password and a code from your current app.');
      return;
    }
    if (!enabled && !currentPassword) {
      setError('Enter your current password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const setup = await api.setupTotp(enabled ? { currentPassword, totpToken: currentCode } : { currentPassword });
      setPending(setup);
      setToken('');
      clearFactorFields();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.confirmTotp(token);
      setEnabled(true);
      setPending(null);
      setToken('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    setPending(null);
    setToken('');
    setError(null);
  }

  async function handleDisable() {
    if (!currentPassword || !currentCode) {
      setError('Enter your current password and a code from your app.');
      return;
    }
    if (!window.confirm('Disable two-factor authentication?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.disableTotp({ currentPassword, totpToken: currentCode });
      setEnabled(false);
      setPending(null);
      clearFactorFields();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;

  if (pending) {
    return (
      <form className="ed-form" onSubmit={handleConfirm}>
        <p>Scan this code with an authenticator app (e.g. Google Authenticator, 1Password):</p>
        {enabled && <p>Your current app keeps working until you confirm the new one.</p>}
        <img src={pending.qrDataUrl} alt="TOTP QR code" width={180} height={180} />
        <div className="ed-field">
          <label>Can&apos;t scan? Enter this key manually:</label>
          <code>{pending.secret}</code>
        </div>
        <div className="ed-field">
          <label>Enter the 6-digit code from your app to confirm:</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="ed-input"
          />
        </div>
        {error && <div className="ed-login-error">{error}</div>}
        <button type="submit" className="ed-btn ed-btn-primary" disabled={busy}>
          Confirm
        </button>
        {enabled && (
          <button type="button" className="ed-btn ed-btn-ghost" onClick={handleCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </form>
    );
  }

  if (enabled) {
    return (
      <div className="ed-form">
        <p>Two-factor authentication is enabled.</p>
        <p>To move it to a new app or turn it off, enter your current password and a code from your app.</p>
        <div className="ed-field">
          <label>Current password</label>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="ed-input"
          />
        </div>
        <div className="ed-field">
          <label>Current 6-digit code</label>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={currentCode}
            onChange={(e) => setCurrentCode(e.target.value)}
            className="ed-input"
          />
        </div>
        <button className="ed-btn ed-btn-primary" onClick={handleEnable} disabled={busy}>
          Use a new authenticator app
        </button>
        <button className="ed-btn ed-btn-ghost" onClick={handleDisable} disabled={busy}>
          Disable
        </button>
        {error && <div className="ed-login-error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="ed-form">
      <p>Two-factor authentication is not enabled.</p>
      <div className="ed-field">
        <label>Current password</label>
        <input
          type="password"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          className="ed-input"
        />
      </div>
      <button className="ed-btn ed-btn-primary" onClick={handleEnable} disabled={busy}>
        Enable two-factor authentication
      </button>
      {error && <div className="ed-login-error">{error}</div>}
    </div>
  );
}
