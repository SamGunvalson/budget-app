import { PostgrestClient } from '@supabase/postgrest-js';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { clearAllOfflineData } from './offlineDb';
import { withReadableError } from './httpErrors';
import {
  clearServerConfig,
  loadServerConfig,
  saveServerConfig,
  testServerConnection,
} from './serverConfig';

let storedConfig = null;
try {
  storedConfig = loadServerConfig();
} catch (error) {
  console.error('Backend: stored server config is invalid:', error);
  clearServerConfig();
}
let _origin = storedConfig?.serverOrigin || (import.meta.env.VITE_API_ORIGIN || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
let _client = null;
let _cachedUser = null;
let _userPromise = null;
let _cacheUnsubscribe = null;
let _bootstrapState = { status: 'needs_setup', source: null, serverOrigin: null };

const nativeFetch = async (url, init = {}) => {
  const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
  const response = await CapacitorHttp.request({
    url: String(url),
    method: init.method || 'GET',
    headers,
    data: init.body,
    responseType: 'text',
    connectTimeout: 10000,
    readTimeout: 30000,
  });
  const responseHeaders = new Headers(response.headers || {});
  const body = response.data == null ? '' : typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
  return new Response(body, { status: response.status, headers: responseHeaders });
};

const platformFetch = (url, init) => Capacitor.isNativePlatform() ? nativeFetch(url, init) : fetch(url, init);

const authedFetch = async (input, init = {}) => {
  const { getAccessToken } = await import('./auth/index.js');
  const send = async (forceRefresh = false) => {
    const token = await getAccessToken({ forceRefresh });
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const requestInit = { ...init, headers };
    const requestUrl = input instanceof Request ? input.url : input;
    return platformFetch(requestUrl, requestInit);
  };
  let response = await send(false);
  let expiredJwt = false;
  if (response.status === 400) {
    try {
      expiredJwt = (await response.clone().json())?.code === 'PGRST301';
    } catch { /* response is not JSON */ }
  }
  if (response.status === 401 || expiredJwt) {
    response = await send(true);
  }
  return withReadableError(response);
};

const applyConfig = ({ serverOrigin, source }) => {
  _origin = serverOrigin || _origin;
  _client = new PostgrestClient(`${_origin}/rest/v1`, { fetch: authedFetch });
  _cachedUser = null;
  _userPromise = null;
  _cacheUnsubscribe?.();
  import('./auth/index.js').then(({ onAuthStateChange }) => {
    _cacheUnsubscribe = onAuthStateChange((_event, session) => { _cachedUser = session?.user ?? null; _userPromise = null; });
  }).catch(() => {});
  _bootstrapState = { status: 'ready', source, serverOrigin: serverOrigin || null };
  return _bootstrapState;
};

export const getServerOrigin = () => _origin;
export const getBootstrapState = () => _bootstrapState;
export const isBackendReady = () => _bootstrapState.status === 'ready';
export const initializeBackend = () => {
  if (storedConfig) return applyConfig({ serverOrigin: storedConfig.serverOrigin, source: 'user-config' });
  // The web app is served by the same nginx that proxies the API, so its own
  // origin is the default. Native builds have no such origin and must ask.
  if (_origin && !Capacitor.isNativePlatform()) return applyConfig({ serverOrigin: _origin, source: 'env-default' });
  _client = null;
  _bootstrapState = { status: 'needs_setup', source: null, serverOrigin: null };
  return _bootstrapState;
};

export const configureServer = async (serverInput) => {
  const resolved = await testServerConnection(serverInput);
  if (_origin !== resolved.serverOrigin) {
    await clearAllOfflineData();
    try {
      const { signOut: adapterSignOut } = await import('./auth/index.js');
      await adapterSignOut();
    } catch { /* old server may already be unreachable */ }
  }
  const persisted = saveServerConfig(resolved);
  storedConfig = persisted;
  return applyConfig({ ...persisted, source: 'user-config' });
};
export const testServer = (serverInput) => testServerConnection(serverInput);

export const db = new Proxy({}, {
  get(_target, prop) {
    const client = _client;
    if (!client) throw new Error('Backend client not initialized. Complete server setup first.');
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

export const getCurrentUser = async () => {
  if (_cachedUser) return _cachedUser;
  if (!_userPromise) {
    _userPromise = import('./auth/index.js').then(({ getSession }) => getSession()).then(({ session, error }) => {
      if (error) throw error;
      _cachedUser = session?.user ?? null;
      return _cachedUser;
    }).catch((error) => { _userPromise = null; throw error; });
  }
  return _userPromise;
};

export const signOut = async () => {
  try { await clearAllOfflineData(); } catch { /* proceed with sign-out */ }
  try { sessionStorage.clear(); } catch { /* storage unavailable */ }
  try {
    const appPrefixes = ['splitSeenAt_'];
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && appPrefixes.some((prefix) => key.startsWith(prefix))) toRemove.push(key);
    }
    toRemove.forEach((key) => localStorage.removeItem(key));
  } catch { /* storage unavailable */ }
  try {
    if ('caches' in self) {
      const names = await caches.keys();
      // `supabase-` names are pre-v2 cache names; purge them on the way out too.
      const prefixes = ['api-', 'reference-tables', 'supabase-', 'workbox-'];
      await Promise.all(names.filter((name) => prefixes.some((prefix) => name.startsWith(prefix))).map((name) => caches.delete(name)));
    }
  } catch { /* cache API unavailable */ }
  const { signOut: adapterSignOut } = await import('./auth/index.js');
  await adapterSignOut();
};

initializeBackend();
