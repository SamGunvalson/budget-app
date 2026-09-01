import { createClient } from '@supabase/supabase-js';
import { clearAllOfflineData } from './offlineDb';
import {
  clearServerConfig,
  loadServerConfig,
  saveServerConfig,
  testServerConnection,
} from './serverConfig';

const runtimeUrl = window.__ENV__?.SUPABASE_URL;
const runtimeKey = window.__ENV__?.SUPABASE_ANON_KEY;
const defaultSupabaseUrl =
  runtimeUrl && !runtimeUrl.startsWith('__') ? runtimeUrl : import.meta.env.VITE_SUPABASE_URL;
const defaultSupabaseAnonKey =
  runtimeKey && !runtimeKey.startsWith('__') ? runtimeKey : import.meta.env.VITE_SUPABASE_ANON_KEY;

let _client = null;
let _authListenerUnsubscribe = null;
let _bootstrapState = {
  status: 'needs_setup',
  source: null,
  serverOrigin: null,
  supabaseUrl: null,
};

// ── Cached user accessor ────────────────────────────────────────────────────
// `supabase.auth.getUser()` makes a network round-trip to GoTrue *and*
// acquires the cross-tab auth lock on every call.  When the app fans out
// many parallel queries (e.g. a Reports page mount firing 6+ RPCs at once,
// each calling `getCurrentUser()` to scope its filter), those calls all
// serialize on the lock — producing the "Lock was not released within
// 5000ms" warning and stalling page loads.
//
// Since the user identity is stable for the lifetime of the session, we
// cache it in module scope.  Population happens lazily on the first call
// (via `getSession()`, which reads from in-memory storage and is cheap)
// and on every auth state change.
let _cachedUser = null;
let _userPromise = null;

const wireAuthCacheListener = (client) => {
  _authListenerUnsubscribe?.();
  const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
    _cachedUser = session?.user ?? null;
    _userPromise = null;
  });
  _authListenerUnsubscribe = () => listener?.subscription?.unsubscribe();
};

const applyClientConfig = ({ supabaseUrl, supabaseAnonKey, source, serverOrigin }) => {
  _client = createClient(supabaseUrl, supabaseAnonKey);
  _cachedUser = null;
  _userPromise = null;
  wireAuthCacheListener(_client);
  _bootstrapState = {
    status: 'ready',
    source,
    serverOrigin: serverOrigin ?? null,
    supabaseUrl,
  };
  return _bootstrapState;
};

const getClientOrThrow = () => {
  if (_client) return _client;
  throw new Error('Supabase client not initialized. Complete server setup first.');
};

export const initializeSupabaseClient = () => {
  try {
    const storedConfig = loadServerConfig();
    if (storedConfig) {
      return applyClientConfig({
        supabaseUrl: storedConfig.supabaseUrl,
        supabaseAnonKey: storedConfig.supabaseAnonKey,
        source: 'user-config',
        serverOrigin: storedConfig.serverOrigin,
      });
    }
  } catch (error) {
    console.error('Supabase: stored server config is invalid:', error);
    clearServerConfig();
  }

  if (defaultSupabaseUrl && defaultSupabaseAnonKey) {
    return applyClientConfig({
      supabaseUrl: defaultSupabaseUrl,
      supabaseAnonKey: defaultSupabaseAnonKey,
      source: 'env-default',
      serverOrigin: null,
    });
  }

  _client = null;
  _cachedUser = null;
  _userPromise = null;
  _bootstrapState = {
    status: 'needs_setup',
    source: null,
    serverOrigin: null,
    supabaseUrl: null,
  };
  return _bootstrapState;
};

export const getSupabaseBootstrapState = () => _bootstrapState;
export const isSupabaseReady = () => _bootstrapState.status === 'ready';

export const configureServer = async (serverInput) => {
  const resolved = await testServerConnection(serverInput);
  const persisted = saveServerConfig(resolved);
  return applyClientConfig({
    supabaseUrl: persisted.supabaseUrl,
    supabaseAnonKey: persisted.supabaseAnonKey,
    source: 'user-config',
    serverOrigin: persisted.serverOrigin,
  });
};

export const testServer = (serverInput) => testServerConnection(serverInput);

export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      const value = getClientOrThrow()[prop];
      return typeof value === 'function' ? value.bind(_client) : value;
    },
  },
);

/**
 * Return the current authenticated user, or `null` if signed out.
 *
 * Uses an in-memory cache that is kept fresh by `onAuthStateChange`, so
 * repeated calls do **not** hit the network or the Supabase auth lock.
 * Concurrent first-callers share a single in-flight `getSession()` promise.
 */
export const getCurrentUser = async () => {
  if (_cachedUser) return _cachedUser;
  if (!_userPromise) {
    _userPromise = getClientOrThrow().auth.getSession().then(({ data, error }) => {
      if (error) {
        _userPromise = null;
        throw error;
      }
      _cachedUser = data?.session?.user ?? null;
      return _cachedUser;
    });
  }
  return _userPromise;
};

// Helper function to sign out — clears all local data before ending the session.
// Wipes (in order, all best-effort): IndexedDB, sessionStorage, app-scoped
// localStorage keys, and Workbox runtime caches. The Supabase auth tokens in
// localStorage are cleared by `supabase.auth.signOut()` itself.
export const signOut = async () => {
  try {
    await clearAllOfflineData();
  } catch {
    // Non-fatal: proceed with sign-out even if local data clear fails
  }

  try {
    sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }

  // Clear app-scoped localStorage entries (e.g. splitSeenAt_<userId>) so a
  // subsequent user on the same device does not inherit prior UI state.
  try {
    const APP_PREFIXES = ["splitSeenAt_"];
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && APP_PREFIXES.some((p) => k.startsWith(p))) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }

  // Clear Workbox runtime caches so the next user does not see the previous
  // user's cached Supabase REST responses (T4 — stolen-device / shared-device).
  try {
    if ("caches" in self) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (n) => n.startsWith("supabase-api") || n.startsWith("workbox-"),
          )
          .map((n) => caches.delete(n)),
      );
    }
  } catch {
    /* cache API unavailable */
  }

  const { error } = await getClientOrThrow().auth.signOut();
  if (error) throw error;
};

initializeSupabaseClient();
