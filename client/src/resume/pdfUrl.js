export const PDF_URL_PATH = '/api/public/resume.pdf';

// The PDF of the public resume at /r/<slug>.
export function publicPdfPath(slug) {
  return `/api/public/resumes/${encodeURIComponent(slug)}/resume.pdf`;
}

// The PDF's URL for a given render. `version` is the server's `pdfVersion`
// (the file's mtime, from the public resume payload or the publish status),
// so every render yields a URL no browser or CDN has cached yet. The
// server sends no-cache headers too, but a cache that already holds the old
// URL, or a CDN that overrides headers, can't be told to forget it — a new
// URL sidesteps both. The server ignores the query string. Without a
// version (no PDF yet, or an older server) it's the bare path. `path` is
// which PDF: the host's public one by default, or publicPdfPath(slug), or
// the editor's per-resume one (resumeApi(id).pdfPath).
export function pdfUrl(version, path = PDF_URL_PATH) {
  if (!version) return path;
  return `${path}?v=${encodeURIComponent(version)}`;
}
