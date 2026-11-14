// The running release, shown at the end of every editor page's top bar.
// Read at build time (Vite keeps only this one field of package.json).
// release-please bumps it with every release, and production builds from
// that checkout, so it follows a rebuild with no server involved.
import { version } from '../../package.json';

export function AppVersion() {
  return (
    <span className="ed-app-version" title={`ResumeCMS ${version}`}>
      v{version}
    </span>
  );
}
