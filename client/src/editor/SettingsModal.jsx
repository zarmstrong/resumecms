import { useState } from 'react';
import { api } from '../api.js';
import { TotpSettings } from './TotpSettings.jsx';

// No backdrop onClick and no Escape-key handler by design: the user must
// explicitly hit Save or Close to dismiss this modal.
export function SettingsModal({ username, onUsernameChange, onClose }) {
  const [newUsername, setNewUsername] = useState(username || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSave() {
    setError(null);

    const trimmedUsername = newUsername.trim();
    const changingPassword = newPassword.length > 0 || confirmPassword.length > 0;
    const changingUsername = trimmedUsername !== username;

    if (!changingPassword && !changingUsername) {
      onClose();
      return;
    }
    if (!currentPassword) {
      setError('Enter your current password to save changes.');
      return;
    }
    if (changingPassword && newPassword !== confirmPassword) {
      setError('New passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const result = await api.updateCredentials({
        currentPassword,
        newUsername: trimmedUsername,
        newPassword: changingPassword ? newPassword : undefined,
      });
      onUsernameChange(result.username);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ed-modal-backdrop">
      <div className="ed-modal" role="dialog" aria-modal="true" aria-labelledby="ed-settings-title">
        <div className="ed-modal-header">
          <h2 id="ed-settings-title">Account Settings</h2>
        </div>

        <div className="ed-modal-body">
          <section className="ed-modal-section">
            <h3>Password</h3>
            <div className="ed-form">
              <div className="ed-field">
                <label>Username</label>
                <input
                  type="text"
                  autoComplete="username"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  className="ed-input"
                />
              </div>
              <div className="ed-field">
                <label>New password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Leave blank to keep current password"
                  className="ed-input"
                />
              </div>
              <div className="ed-field">
                <label>Confirm new password</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="ed-input"
                />
              </div>
              <div className="ed-field">
                <label>Current password</label>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Required to save changes"
                  className="ed-input"
                />
              </div>
              {error && <div className="ed-login-error">{error}</div>}
            </div>
          </section>

          <section className="ed-modal-section">
            <h3>Two-Factor Authentication</h3>
            <TotpSettings />
          </section>

          <div className="ed-modal-actions">
            <button type="button" className="ed-btn ed-btn-ghost" onClick={onClose} disabled={busy}>
              Close
            </button>
            <button type="button" className="ed-btn ed-btn-primary" onClick={handleSave} disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
