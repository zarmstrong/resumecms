import { useState } from 'react';
import { api } from '../api.js';

export function LoginPage({ onAuthenticated }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onAuthenticated();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-login-screen">
      <form className="ed-login-card" onSubmit={handleSubmit}>
        <h1 className="ed-login-title">Editor</h1>
        <p className="ed-login-sub">Enter the site password to make changes.</p>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="ed-input"
        />
        {error && <div className="ed-login-error">{error}</div>}
        <button type="submit" className="ed-btn ed-btn-primary" disabled={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
