import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function TotpSettings() {
  const [enabled, setEnabled] = useState(null);
  const [pending, setPending] = useState(null); // { secret, qrDataUrl } while enrolling
  const [token, setToken] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getTotpStatus().then((s) => setEnabled(s.enabled));
  }, []);

  async function handleEnable() {
    setBusy(true);
    setError(null);
    try {
      const setup = await api.setupTotp();
      setPending(setup);
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

  async function handleDisable() {
    if (!window.confirm('Disable two-factor authentication?')) return;
    setBusy(true);
    setError(null);
    try {
      await api.disableTotp();
      setEnabled(false);
      setPending(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;

  if (enabled) {
    return (
      <div className="ed-form">
        <p>Two-factor authentication is enabled.</p>
        <button className="ed-btn ed-btn-ghost" onClick={handleDisable} disabled={busy}>
          Disable
        </button>
        {error && <div className="ed-login-error">{error}</div>}
      </div>
    );
  }

  if (pending) {
    return (
      <form className="ed-form" onSubmit={handleConfirm}>
        <p>Scan this code with an authenticator app (e.g. Google Authenticator, 1Password):</p>
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
      </form>
    );
  }

  return (
    <div className="ed-form">
      <p>Two-factor authentication is not enabled.</p>
      <button className="ed-btn ed-btn-primary" onClick={handleEnable} disabled={busy}>
        Enable two-factor authentication
      </button>
      {error && <div className="ed-login-error">{error}</div>}
    </div>
  );
}
