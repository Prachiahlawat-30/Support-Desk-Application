const TOKEN_KEY = 'supportDesk.token';

export class ApiError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (token) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

let onUnauthorized = () => {};
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function request(path, { method = 'GET', body, query } = {}) {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check that the API is running and try again.');
  }

  if (res.status === 204) return null;
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    const error = payload?.error;
    throw new ApiError(res.status, error?.message || `Request failed (${res.status})`, error);
  }
  return payload;
}

/** Downloads a file from the API (with the auth header) and saves it under the server's filename. */
async function download(path, query) {
  const url = new URL(`/api${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  const token = tokenStore.get();
  let res;
  try {
    res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check that the API is running and try again.');
  }
  if (!res.ok) {
    const error = (await res.json().catch(() => null))?.error;
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, error?.message || `Download failed (${res.status})`, error);
  }
  const filename = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'export.csv';
  const href = URL.createObjectURL(await res.blob());
  const link = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  return filename;
}

export const api = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me'),
  listAgents: () => request('/agents'),
  dashboard: () => request('/dashboard'),
  listTickets: (query) => request('/tickets', { query }),
  getTicket: (id) => request(`/tickets/${id}`),
  createTicket: (ticket) => request('/tickets', { method: 'POST', body: ticket }),
  updateTicket: (id, changes) => request(`/tickets/${id}`, { method: 'PATCH', body: changes }),
  deleteTicket: (id) => request(`/tickets/${id}`, { method: 'DELETE' }),
  addMessage: (id, message) => request(`/tickets/${id}/messages`, { method: 'POST', body: message }),
  analyzeTicket: (id) => request(`/tickets/${id}/analyze`, { method: 'POST' }),
  draftReply: (id) => request(`/tickets/${id}/draft-reply`, { method: 'POST' }),
  analyticsOverview: (query) => request('/analytics/overview', { query }),
  analyticsAgents: (query) => request('/analytics/agents', { query }),
  exportAnalytics: (query) => download('/analytics/export', query),
  acknowledgeEscalation: (id) => request(`/tickets/${id}/escalation/acknowledge`, { method: 'POST' }),
};
