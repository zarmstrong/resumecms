import { iconContent, iconVersions, siteAccent } from './favicon.js';

// What the site's icon shows on a host (issue #104), asked of the store
// exactly as `/`'s own fetch (GET /api/public/home) asks: the landing page
// while landingForHost() shows it, else forHost()'s resume, and only ever
// what's published. The landing page's name is the default resume's
// published one (as its JSON-LD Person's is), its headline only when that
// has none, and its colors are its resolved `site`: its own palette when it
// has one, with its dark palette's accent under `prefers-color-scheme:
// dark`. Throws when the store does; each caller decides what that means.
export function iconContentFor(store, hostname) {
  const landing = store.landingForHost(hostname);
  if (landing) {
    const name = store.getPublishedResume('web').header?.name?.trim() || landing.headline;
    return iconContent({ name, accent: siteAccent(landing.site), darkColors: landing.darkColors });
  }
  const published = store.forHost(hostname).getPublishedResume('web');
  if (!published.header) return iconContent();
  return iconContent({ name: published.header.name, accent: siteAccent(published.site) });
}

// The `?v=` of the HTML shell's two icon links for a request's host (issue
// #108, clientStatic.js's withIconVersions()): favicon.js's iconVersions()
// of what the routes would serve that host, so a published rename or
// recolor is a URL no cache has seen, as `pdfVersion` is for the PDF
// (#54). Null when the store throws, and the shell keeps the bare paths:
// a version worked out from the neutral icon would name whatever the
// route serves once the store is back.
export function createIconVersions(store) {
  return (req) => {
    try {
      return iconVersions(iconContentFor(store, req.hostname));
    } catch (err) {
      console.error('Could not work out the icon links:', err);
      return null;
    }
  };
}
