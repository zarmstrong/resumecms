// The end of every editor page's top bar: Log out, then the running
// release. Kept together so a wrap never leaves the version alone on a line.
// The version is read at build time (Vite keeps only this one field of
// package.json); release-please bumps it with every release, and
// appVersion.test.js checks it against the manifest the image is tagged from.
import { version } from '../../package.json';

export function TopbarEnd({ onLogout, disabled }) {
  return (
    <span className="ed-topbar-end">
      <button className="ed-btn ed-btn-ghost" onClick={onLogout} disabled={disabled}>
        Log out
      </button>
      <span className="ed-app-version">
        <span className="ed-sr-only">ResumeCMS version </span>v{version}
      </span>
    </span>
  );
}
