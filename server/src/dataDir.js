// The one place the data directory is derived from the environment; db.js
// (resume.sqlite3) and pdfRenderer.js (resume.pdf) both build their paths
// from it, so they can't drift into different directories.
export const DATA_DIR = process.env.RESUMECMS_DATA_DIR || '/data';
