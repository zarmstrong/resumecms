// @ts-check
const BASE = '/api';

/**
 * What a failed call rejects with: the server's `{ error }` as the message,
 * and the HTTP status (routes/sendError.js).
 * @typedef {Error & { status: number }} ApiError
 */
/**
 * A block as the server's routes send and take it (Block in the server's
 * blockRows.js; `data` is its type's shape, blockData.js).
 * @typedef {'heading' | 'summary' | 'executive_summary' | 'skills_group' | 'experience' | 'education' | 'credentials' | 'custom'} BlockType
 * @typedef {{ id: string, type: BlockType, position: number, parentId: string | null, visibleWeb: boolean, visiblePrint: boolean, data: Record<string, any> }} Block
 * @typedef {{ data?: Record<string, any> | null, parentId?: string | null, visibleWeb?: boolean, visiblePrint?: boolean }} BlockPatch
 */
/**
 * A tailoring brief (Brief in the server's ai/brief.js); the server trims
 * it and fills in a missing field with ''.
 * @typedef {{ audience: string, posting?: string, guidance?: string }} TailoringBrief
 * @typedef {import('./editor/aiReview.js').AiTarget} AiTarget
 */

/**
 * @param {string} path under /api
 * @param {RequestInit} [options]
 * @returns {Promise<any>} the response's JSON, or null for a 204
 */
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
    const err = /** @type {ApiError} */ (new Error(detail || `Request failed: ${res.status}`));
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
  cancelTotp: (secret) => request('/auth/totp/cancel', { method: 'POST', body: JSON.stringify({ secret }) }),
  disableTotp: (payload) => request('/auth/totp/disable', { method: 'POST', body: JSON.stringify(payload) }),

  getCredentials: () => request('/auth/credentials'),
  updateCredentials: (payload) => request('/auth/credentials', { method: 'POST', body: JSON.stringify(payload) }),

  getAiSettings: () => request('/ai/settings'),
  updateAiSettings: (payload) => request('/ai/settings', { method: 'PUT', body: JSON.stringify(payload) }),

  // The install's resumes (issue #53). The content of one is edited through
  // resumeApi(id) below.
  listResumes: () => request('/resumes'),
  /** @param {{ name: string, slug?: string, copyFrom?: string, tailoring?: TailoringBrief | null }} input */
  createResume: (input) => request('/resumes', { method: 'POST', body: JSON.stringify(input) }),
  /**
   * @param {string} id
   * @param {{ name?: string, slug?: string, isPublic?: boolean, isDefault?: true, hostnames?: string[], tailoring?: TailoringBrief | null }} patch
   */
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
  /**
   * @param {'web' | 'print'} mode
   * @param {string | null} [slug]
   */
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
/** @param {string} resumeId */
export function resumeApi(resumeId) {
  const prefix = `/resumes/${encodeURIComponent(resumeId)}`;
  return {
    getHeader: () => request(`${prefix}/header`),
    putHeader: (header) => request(`${prefix}/header`, { method: 'PUT', body: JSON.stringify(header) }),

    getSite: () => request(`${prefix}/site`),
    putSite: (site) => request(`${prefix}/site`, { method: 'PUT', body: JSON.stringify(site) }),

    getBlocks: () => request(`${prefix}/blocks`),
    /**
     * @param {BlockType} type
     * @param {Record<string, any> | null} data
     * @param {string | null} [parentId]
     * @returns {Promise<Block>}
     */
    createBlock: (type, data, parentId = null) =>
      request(`${prefix}/blocks`, { method: 'POST', body: JSON.stringify({ type, data, parentId }) }),
    /**
     * @param {string} id
     * @param {BlockPatch} patch
     * @returns {Promise<Block>}
     */
    updateBlock: (id, patch) => request(`${prefix}/blocks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
    deleteBlock: (id) => request(`${prefix}/blocks/${id}`, { method: 'DELETE' }),
    // items: [{ id, parentId }] in the desired flat order (a heading's
    // children immediately follow it) — see BlockList.jsx's flat-order model.
    /**
     * @param {{ id: string, parentId: string | null }[]} items
     * @returns {Promise<Block[]>}
     */
    reorderBlocks: (items) => request(`${prefix}/blocks/reorder`, { method: 'POST', body: JSON.stringify({ items }) }),

    // Returns a proposal only — nothing is saved until it's accepted and sent
    // through updateBlock like any other edit.
    // `target` narrows the rewrite to part of the block (see aiReview.js).
    // `tense` is only sent for blocks with a tense picker (the settings'
    // pickedTenseTypes); undefined drops out of the JSON. `brief` (a
    // resume's tailoring) tailors the rewrite; with one, the instruction
    // may be empty.
    /**
     * @param {string} blockId
     * @param {Record<string, any>} data
     * @param {string} instruction
     * @param {AiTarget | null | undefined} target
     * @param {string | null | undefined} tense
     * @param {TailoringBrief | null} [brief]
     * @returns {Promise<{ proposal: import('./editor/aiReview.js').AiProposal }>}
     */
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
