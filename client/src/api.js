const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body.error || '';
    } catch {
      // ignore
    }
    const err = new Error(detail || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  authStatus: () => request('/auth/status'),
  getCaptchaConfig: () => request('/auth/captcha-config'),
  login: (username, password, captchaToken, totpToken) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password, captchaToken, totpToken }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),

  getTotpStatus: () => request('/auth/totp/status'),
  // While 2FA is on, replacing or disabling it takes `{ currentPassword, totpToken }`.
  setupTotp: (payload = {}) => request('/auth/totp/setup', { method: 'POST', body: JSON.stringify(payload) }),
  confirmTotp: (token) => request('/auth/totp/confirm', { method: 'POST', body: JSON.stringify({ token }) }),
  disableTotp: (payload) => request('/auth/totp/disable', { method: 'POST', body: JSON.stringify(payload) }),

  getCredentials: () => request('/auth/credentials'),
  updateCredentials: (payload) => request('/auth/credentials', { method: 'POST', body: JSON.stringify(payload) }),

  getAiSettings: () => request('/ai/settings'),
  updateAiSettings: (payload) => request('/ai/settings', { method: 'PUT', body: JSON.stringify(payload) }),

  // The install's resumes (issue #53). The content of one is edited through
  // resumeApi(id) below.
  listResumes: () => request('/resumes'),
  // { name, slug?, copyFrom? }
  createResume: (input) => request('/resumes', { method: 'POST', body: JSON.stringify(input) }),
  // Any of { name, slug, isPublic, isDefault: true, hostnames }
  updateResume: (id, patch) =>
    request(`/resumes/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteResume: (id) => request(`/resumes/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // The install's landing page (issue #70): its draft, status, and what its
  // preview resolves against. Not per resume.
  getLanding: () => request('/landing'),
  // Its text holds links and emphasis (issue #91): a write without
  // `textFormat: 'inline'` is taken as plain text, and escaped.
  putLanding: (landing) => request('/landing', { method: 'PUT', body: JSON.stringify({ ...landing, textFormat: 'inline' }) }),
  landingStatus: () => request('/landing/status'),
  publishLanding: () => request('/landing/publish', { method: 'POST' }),
  discardLandingDraft: () => request('/landing/discard-draft', { method: 'POST' }),
  setLandingEnabled: (enabled) => request('/landing/enabled', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  // The stored draft's own colors and fonts into the default resume's site
  // settings draft (issue #93): { resumeId, site }.
  applyLandingStyle: () => request('/landing/apply-style', { method: 'POST' }),
  // An image for the landing page (issue #92): the file itself as the body.
  // Resolves with { id, mime, width, height, src } once the server has
  // re-encoded and stored it.
  uploadLandingImage: (file) =>
    request('/landing/images', { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }),
  // A PDF for a documents section (issue #128), the file itself as the
  // body and its name in the query. Resolves with { id, size, name, src }
  // once the server has stripped its metadata and stored it.
  uploadLandingFile: (file) =>
    request(`/landing/files?name=${encodeURIComponent(file.name || '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/pdf' },
      body: file,
    }),
  // An AI rewrite of one spot on the landing page (issue #73): the draft as
  // the editor has it, without its photo (landingAi.js's rewriteCopy). Saves
  // nothing; resolves with { target, proposals, explanation }.
  landingRewrite: (landing, target, instruction) =>
    request('/landing/rewrite', {
      method: 'POST',
      body: JSON.stringify({ landing: landing && { ...landing, textFormat: 'inline' }, target, instruction }),
    }),

  // What `/` shows on this host: { kind: 'landing', landing } or
  // { kind: 'resume', resume }.
  getPublicHome: () => request('/public/home'),

  // The published resume the server picks for this host (`/`), or the
  // public one at /r/<slug> when `slug` is given.
  getPublicResume: (mode, slug = null) =>
    request(slug ? `/public/resumes/${encodeURIComponent(slug)}?mode=${mode}` : `/public/resume?mode=${mode}`),

  // The cover letter the PDF renderer's /print/letter page is rendering
  // (its render cookie names it): { header, site, letter, today }.
  getLetterForRender: () => request('/public/letter'),
};

// The editor's calls for one resume, all under /api/resumes/:id, so a call
// can't land on another resume by leaving an id out. (The server's
// unprefixed /api routes still mean the default resume; the editor doesn't
// use them.)
export function resumeApi(resumeId) {
  const prefix = `/resumes/${encodeURIComponent(resumeId)}`;
  return {
    getHeader: () => request(`${prefix}/header`),
    putHeader: (header) => request(`${prefix}/header`, { method: 'PUT', body: JSON.stringify(header) }),

    getSite: () => request(`${prefix}/site`),
    putSite: (site) => request(`${prefix}/site`, { method: 'PUT', body: JSON.stringify(site) }),

    getBlocks: () => request(`${prefix}/blocks`),
    createBlock: (type, data, parentId = null) =>
      request(`${prefix}/blocks`, { method: 'POST', body: JSON.stringify({ type, data, parentId }) }),
    updateBlock: (id, patch) => request(`${prefix}/blocks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    deleteBlock: (id) => request(`${prefix}/blocks/${id}`, { method: 'DELETE' }),
    // items: [{ id, parentId }] in the desired flat order (a heading's
    // children immediately follow it) — see BlockList.jsx's flat-order model.
    reorderBlocks: (items) => request(`${prefix}/blocks/reorder`, { method: 'POST', body: JSON.stringify({ items }) }),

    // Returns a proposal only — nothing is saved until it's accepted and sent
    // through updateBlock like any other edit.
    // `target` narrows the rewrite to part of the block (see aiReview.js).
    // `tense` is only sent for blocks with a tense picker (the settings'
    // pickedTenseTypes); undefined drops out of the JSON. `brief` (a
    // resume's tailoring) tailors the rewrite; with one, the instruction
    // may be empty.
    aiRewrite: (blockId, data, instruction, target, tense, brief) =>
      request(`${prefix}/ai/rewrite`, {
        method: 'POST',
        body: JSON.stringify({ blockId, data, instruction, target, tense, brief: brief || undefined }),
      }),
    // A tailoring plan (issue #84, editor/tailorPlan.js): what to hide and a
    // section order for `brief`, from the stored draft. Saves nothing.
    tailorPlan: ({ brief, hide, order, hideFrom }) =>
      request(`${prefix}/ai/tailor-plan`, { method: 'POST', body: JSON.stringify({ brief, hide, order, hideFrom }) }),

    publish: () => request(`${prefix}/publish`, { method: 'POST' }),
    publishStatus: () => request(`${prefix}/publish/status`),
    discardDraft: () => request(`${prefix}/discard-draft`, { method: 'POST' }),

    // Behind login, so a private resume's PDF downloads too.
    pdfPath: `${BASE}${prefix}/resume.pdf`,

    // Its cover letters (issue #71). updateCoverLetter's `data` replaces
    // the letter's data whole.
    listCoverLetters: () => request(`${prefix}/cover-letters`),
    // {} for an empty one, { copyFrom: <letter id> } for a copy.
    createCoverLetter: (input) => request(`${prefix}/cover-letters`, { method: 'POST', body: JSON.stringify(input) }),
    updateCoverLetter: (id, patch) =>
      request(`${prefix}/cover-letters/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) }),
    deleteCoverLetter: (id) => request(`${prefix}/cover-letters/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    // AI writing for a letter (letters/letterAi.js): a proposal for the
    // whole letter or one paragraph (`target`), written from `data` (what
    // the editor shows) and the resume; nothing is saved. `brief` is
    // optional; without one, a letter with a body needs an instruction.
    rewriteCoverLetter: (id, { data, target, instruction, brief }) =>
      request(`${prefix}/cover-letters/${encodeURIComponent(id)}/rewrite`, {
        method: 'POST',
        body: JSON.stringify({ data, target, instruction, brief: brief || undefined }),
      }),
    // Rendered on request (a cached render when nothing changed).
    coverLetterPdfPath: (id) => `${BASE}${prefix}/cover-letters/${encodeURIComponent(id)}/letter.pdf`,
  };
}
