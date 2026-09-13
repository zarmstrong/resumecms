import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Captcha } from './Captcha.jsx';

export function LoginPage({ onAuthenticated }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpToken, setTotpToken] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [captchaConfig, setCaptchaConfig] = useState(null);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaResetKey, setCaptchaResetKey] = useState(0);

  useEffect(() => {
    api
      .getCaptchaConfig()
      .then(setCaptchaConfig)
      .catch(() => setCaptchaConfig({ provider: null, siteKey: null, totpRequired: false }));
  }, []);

  const captchaRequired = Boolean(captchaConfig?.provider);
  const totpRequired = Boolean(captchaConfig?.totpRequired);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(username, password, captchaToken, totpToken);
      onAuthenticated();
    } catch (err) {
      setError(err.message);
      setCaptchaToken('');
      setCaptchaResetKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-login-screen">
      <form className="ed-login-card" onSubmit={handleSubmit}>
        <h1 className="ed-login-title">Editor</h1>
        <p className="ed-login-sub">Sign in to make changes.</p>
        <input
          autoFocus
          type="text"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          className="ed-input"
        />
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="ed-input"
        />
        {totpRequired && (
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoComplete="one-time-code"
            value={totpToken}
            onChange={(e) => setTotpToken(e.target.value)}
            placeholder="Authentication code"
            className="ed-input"
          />
        )}
        {captchaRequired && (
          <Captcha
            provider={captchaConfig.provider}
            siteKey={captchaConfig.siteKey}
            onToken={setCaptchaToken}
            resetKey={captchaResetKey}
          />
        )}
        {error && <div className="ed-login-error">{error}</div>}
        <button
          type="submit"
          className="ed-btn ed-btn-primary"
          disabled={busy || (captchaRequired && !captchaToken)}
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
