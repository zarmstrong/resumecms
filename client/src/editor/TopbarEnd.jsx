// The end of every editor page's top bar: Log out, then the running
// release. Kept together so a wrap never leaves the version alone on a line.
// The version is client/package.json's, inlined at build time as
// __APP_VERSION__ (vite.config.js's `define`).

export function TopbarEnd({ onLogout, disabled }) {
  return (
    <span className="ed-topbar-end">
      <button className="ed-btn ed-btn-ghost" onClick={onLogout} disabled={disabled}>
        Log out
      </button>
      <span className="ed-app-version">
        <span className="ed-sr-only">ResumeCMS version </span>v{__APP_VERSION__}
      </span>
    </span>
  );
}
