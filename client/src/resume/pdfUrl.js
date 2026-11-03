export const PDF_URL_PATH = '/api/public/resume.pdf';

// The PDF's URL for a given render. `version` is the server's `pdfVersion`
// (the file's mtime, from the public resume payload or the publish status),
// so every render yields a URL no browser or CDN has cached yet. The
// server sends no-cache headers too, but a cache that already holds the old
// URL, or a CDN that overrides headers, can't be told to forget it — a new
// URL sidesteps both. The server ignores the query string. Without a
// version (no PDF yet, or an older server) it's the bare path.
export function pdfUrl(version) {
  if (!version) return PDF_URL_PATH;
  return `${PDF_URL_PATH}?v=${encodeURIComponent(version)}`;
}
