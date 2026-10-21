import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { getServerOrigin } from '../backend';

const STORAGE_KEY = 'budgetApp.auth.v1';
const REFRESH_EARLY_MS = 60_000;
const listeners = new Set();
let refreshPromise = null;
let refreshTimer = null;
let currentSession = null;

const readStoredSession = () => {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    currentSession = value ? JSON.parse(value) : null;
  } catch { currentSession = null; }
  return currentSession;
};
const persistSession = (session, event) => {
  currentSession = session;
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* session remains available in memory */ }
  scheduleRefresh(session);
  if (event) listeners.forEach((callback) => callback(event, session));
};
const scheduleRefresh = (session) => {
  clearTimeout(refreshTimer);
  if (!session?.expires_at) return;
  const delay = Math.max(0, session.expires_at * 1000 - Date.now() - REFRESH_EARLY_MS);
  refreshTimer = setTimeout(() => { refreshSession().catch(() => {}); }, delay);
};
const authFetch = async (path, { method = 'GET', body, headers = {} } = {}) => {
  const url = `${getServerOrigin()}${path}`;
  const requestHeaders = { Accept: 'application/json', ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const options = { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body) };
  let response;
  if (Capacitor.isNativePlatform()) {
    const native = await CapacitorHttp.request({ url, method, headers: requestHeaders, data: options.body, responseType: 'text', connectTimeout: 10000, readTimeout: 30000 });
    response = new Response(native.data == null ? '' : typeof native.data === 'string' ? native.data : JSON.stringify(native.data), { status: native.status, headers: native.headers || {} });
  } else {
    response = await fetch(url, options);
  }
  if (response.ok || response.status === 204) return response;
  let payload = {};
  try { payload = await response.json(); } catch { /* use HTTP fallback */ }
  const error = new Error(payload?.error?.message || payload?.message || `Auth request failed (${response.status}).`);
  error.status = response.status;
  error.code = payload?.error?.code;
  throw error;
};
const isNetworkFailure = (error) => !error?.status;
const toSessionError = (error) => ({ session: readStoredSession(), error: error ?? null });

export const getSession = async () => ({ session: readStoredSession(), error: null });
export const onAuthStateChange = (callback) => {
  listeners.add(callback);
  callback('INITIAL_SESSION', readStoredSession());
  return () => listeners.delete(callback);
};
export const signInWithPassword = async ({ email, password }) => {
  try {
    const session = await authFetch('/auth/v1/token', { method: 'POST', body: { grant_type: 'password', email, password } });
    const value = await session.json();
    persistSession(value, 'SIGNED_IN');
    return { session: value, error: null };
  } catch (error) { return toSessionError(error); }
};
export const signUp = async ({ email, password }) => {
  try {
    const response = await authFetch('/auth/v1/signup', { method: 'POST', body: { email, password } });
    const session = await response.json();
    persistSession(session, 'SIGNED_IN');
    return { session, error: null, needsConfirmation: false };
  } catch (error) { return { ...toSessionError(error), needsConfirmation: false }; }
};

const doRefresh = async ({ force = false } = {}) => {
  const before = readStoredSession();
  if (!before?.refresh_token) return before;
  if (!force && before.expires_at * 1000 - Date.now() > REFRESH_EARLY_MS) return before;
  const run = async () => {
    const latest = readStoredSession();
    if (!latest?.refresh_token) return latest;
    if (latest.refresh_token !== before.refresh_token && latest.expires_at * 1000 - Date.now() > REFRESH_EARLY_MS) return latest;
    try {
      const response = await authFetch('/auth/v1/token', { method: 'POST', body: { grant_type: 'refresh_token', refresh_token: latest.refresh_token } });
      const session = await response.json();
      persistSession(session, 'TOKEN_REFRESHED');
      return session;
    } catch (error) {
      if (error.status === 400 || error.status === 401) {
        persistSession(null, 'SIGNED_OUT');
        return null;
      }
      if (isNetworkFailure(error)) return latest;
      throw error;
    }
  };
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    return navigator.locks.request(`${STORAGE_KEY}.refresh`, run);
  }
  if (!refreshPromise) refreshPromise = run().finally(() => { refreshPromise = null; });
  return refreshPromise;
};
export const refreshSession = (options = {}) => doRefresh({ force: true, ...options });
export const getAccessToken = async ({ forceRefresh = false } = {}) => {
  const session = await doRefresh({ force: forceRefresh });
  return session?.access_token ?? null;
};
export const signOut = async () => {
  const session = readStoredSession();
  try {
    if (session?.refresh_token) await authFetch('/auth/v1/logout', { method: 'POST', body: { refresh_token: session.refresh_token } });
  } catch { /* logout is best effort; always clear local credentials */ }
  persistSession(null, 'SIGNED_OUT');
};
export const updatePassword = async ({ currentPassword, newPassword }) => {
  const session = readStoredSession();
  if (!session?.refresh_token) return { error: new Error('You must be signed in to change your password.') };
  try {
    const accessToken = await getAccessToken();
    const latest = readStoredSession();
    if (!accessToken || !latest?.refresh_token) return { error: new Error('Your session has expired. Please sign in again.') };
    await authFetch('/auth/v1/user/password', { method: 'PUT', body: { current_password: currentPassword, new_password: newPassword, refresh_token: latest.refresh_token }, headers: { Authorization: `Bearer ${accessToken}` } });
    return { error: null };
  } catch (error) { return { error }; }
};
export const getSignupHealth = async () => {
  try {
    const response = await authFetch('/auth/v1/health');
    return await response.json();
  } catch (error) { return { signupEnabled: false, error }; }
};

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY) return;
    try { currentSession = event.newValue ? JSON.parse(event.newValue) : null; }
    catch { currentSession = null; }
    scheduleRefresh(currentSession);
    listeners.forEach((callback) => callback(currentSession ? 'TOKEN_REFRESHED' : 'SIGNED_OUT', currentSession));
  });
}
readStoredSession();
scheduleRefresh(currentSession);
