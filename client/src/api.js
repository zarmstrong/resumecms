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
  setupTotp: () => request('/auth/totp/setup', { method: 'POST' }),
  confirmTotp: (token) => request('/auth/totp/confirm', { method: 'POST', body: JSON.stringify({ token }) }),
  disableTotp: () => request('/auth/totp/disable', { method: 'POST' }),

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

  // The published resume the server picks for this host (`/`), or the
  // public one at /r/<slug> when `slug` is given.
  getPublicResume: (mode, slug = null) =>
    request(slug ? `/public/resumes/${encodeURIComponent(slug)}?mode=${mode}` : `/public/resume?mode=${mode}`),
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

    publish: () => request(`${prefix}/publish`, { method: 'POST' }),
    publishStatus: () => request(`${prefix}/publish/status`),
    discardDraft: () => request(`${prefix}/discard-draft`, { method: 'POST' }),

    // Behind login, so a private resume's PDF downloads too.
    pdfPath: `${BASE}${prefix}/resume.pdf`,
  };
}
