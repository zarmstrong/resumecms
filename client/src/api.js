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

  getHeader: () => request('/header'),
  putHeader: (header) => request('/header', { method: 'PUT', body: JSON.stringify(header) }),

  getSite: () => request('/site'),
  putSite: (site) => request('/site', { method: 'PUT', body: JSON.stringify(site) }),

  getBlocks: () => request('/blocks'),
  createBlock: (type, data, parentId = null) =>
    request('/blocks', { method: 'POST', body: JSON.stringify({ type, data, parentId }) }),
  updateBlock: (id, patch) => request(`/blocks/${id}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteBlock: (id) => request(`/blocks/${id}`, { method: 'DELETE' }),
  // items: [{ id, parentId }] in the desired flat order (a heading's
  // children immediately follow it) — see BlockList.jsx's flat-order model.
  reorderBlocks: (items) => request('/blocks/reorder', { method: 'POST', body: JSON.stringify({ items }) }),

  getPublicResume: (mode) => request(`/public/resume?mode=${mode}`),

  publish: () => request('/publish', { method: 'POST' }),
  publishStatus: () => request('/publish/status'),
  discardDraft: () => request('/discard-draft', { method: 'POST' }),
};
