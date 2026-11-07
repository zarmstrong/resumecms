// Pure helpers for the editor's resume switcher and resume settings (issue
// #53), kept apart from the components so resumeLinks.test.js covers them.
// A resume here is what GET /api/resumes lists: { id, slug, name,
// isDefault, isPublic, hostnames, publishedAt, ... }.

// The resume to open: the one `?resume=` asks for if it still exists (a
// bookmark can outlive a deleted resume), otherwise the default.
export function pickResume(resumes, requestedId) {
  return resumes.find((r) => r.id === requestedId) || resumes.find((r) => r.isDefault) || resumes[0] || null;
}

// Where anyone can see the resume, or null while nobody but the editor can:
// the main site for the default, its first domain if it has one (the
// address people are meant to use), else its /r/<slug> link. `location` is
// window.location (or anything with protocol, port and origin); a domain
// keeps the editor's own scheme and port, which is what a dev server on
// *.localhost needs and a production one (no port) doesn't notice.
// `landingShown`: the landing page holds `/` (issue #70), so the default
// resume is at /resume.
export function publicUrl(resume, location, { landingShown = false } = {}) {
  if (!resume.publishedAt) return null;
  if (resume.isDefault) return `${location.origin}/${landingShown ? 'resume' : ''}`;
  if (!resume.isPublic) return null;
  if (resume.hostnames?.length) {
    return `${location.protocol}//${resume.hostnames[0]}${location.port ? `:${location.port}` : ''}/`;
  }
  return `${location.origin}/r/${encodeURIComponent(resume.slug)}`;
}

// How the switcher names a resume: its name plus who can see it.
export function resumeLabel(resume) {
  let status;
  if (resume.isDefault) status = 'default';
  else if (!resume.isPublic) status = 'private';
  else if (!resume.publishedAt) status = 'public, not published yet';
  else status = 'public';
  return `${resume.name} (${status})`;
}

// The domains textarea: one per line (commas and spaces work too). The
// server normalizes and validates each one.
export function parseHostnames(text) {
  return String(text)
    .split(/[\s,]+/)
    .filter(Boolean);
}

// Only the fields the resume settings form changed, as a PATCH body for
// updateResume (so an untouched slug is never re-sent and re-checked).
// `form` is { name, slug, isPublic, hostnames: text }.
export function resumePatch(resume, form) {
  const patch = {};
  if (form.name.trim() !== resume.name) patch.name = form.name.trim();
  if (form.slug.trim() !== resume.slug) patch.slug = form.slug.trim();
  const hostnames = parseHostnames(form.hostnames);
  if (hostnames.join('\n') !== resume.hostnames.join('\n')) patch.hostnames = hostnames;
  // The default and a resume with domains are always public (the server
  // would refuse isPublic: false), so the form's checkbox only counts for
  // neither. The default's form can still hold the false it opened with,
  // when "Make this the default" was used on a private resume.
  if (resume.isDefault) return patch;
  const isPublic = hostnames.length > 0 || form.isPublic;
  if (isPublic !== resume.isPublic) patch.isPublic = isPublic;
  return patch;
}

// The switcher's entry for the landing page (issue #70), next to the
// resumes; a resume id is a UUID, so it can't collide.
export const LANDING_PAGE = 'landing';

// A resume's cover letters (issue #71) have their own page in the editor,
// ?page=letters next to the resume's own ?resume=<id>.
export const LETTERS_PAGE = 'letters';

// The editor's search params for `resume` (its own editor, or with `page`
// one of its pages): the default resume needs no ?resume=.
export function editorParams(resume, page = null) {
  const params = {};
  if (page) params.page = page;
  if (resume && !resume.isDefault) params.resume = resume.id;
  return params;
}

// What the landing page's status means for visitors: whether `/` shows it
// (on this, the main domain). `status` is { enabled, publishedAt }.
export function landingShown(status) {
  return Boolean(status?.enabled && status?.publishedAt);
}
