import { useCallback, useContext, useEffect, useState } from 'react';
import { getUserPreferenceOffline as getUserPreference, setUserPreferenceOffline as setUserPreference } from '../services/offlineAware';
import { setSafeModeEnabled } from '../utils/helpers';
import AuthContext, { getSessionUserId } from './authContextValue';
import { SafeModeContext } from './safeModeContextValue';

const PREF_KEY = 'safe_mode';
const SEED_KEY = 'safe_mode_seed';

/**
 * Generate or retrieve a stable per-session seed (0.4 – 2.5).
 * Stored in sessionStorage so the same tab always produces the
 * same masked values, but a new tab/session gets different ones.
 */
function getSessionSeed() {
  try {
    const stored = sessionStorage.getItem(SEED_KEY);
    if (stored) return Number(stored);
  } catch { /* SSR / privacy mode */ }
  const seed = 0.4 + Math.random() * 2.1; // 0.4 – 2.5
  try { sessionStorage.setItem(SEED_KEY, String(seed)); } catch { /* ignore */ }
  return seed;
}

/**
 * Provides `isSafeMode`, `toggleSafeMode` and `isReady` to the entire app.
 *
 * When safe mode is active the module-level flag in helpers.js is set
 * so that `formatCurrency`, `toDollars`, and `maskAccountName` all
 * return scrambled / masked values without any component refactoring.
 *
 * The preference is persisted to Supabase (`user_preferences`) via
 * the offline-aware layer, identical to the theme preference.
 *
 * The preference is stored together with the user id it was loaded for and
 * is re-read on every sign-in, so it never carries over between users. Must
 * render below <AuthProvider>.
 *
 * Privacy: `isReady` is false from the moment a user is signed in until
 * their preference has resolved. Nothing that displays amounts may render
 * while it is false (App.jsx gates protected pages on it) — the helpers read
 * a module-level flag at render time and pages do not re-render when it
 * flips, so rendering early would leave real amounts on screen.
 */
const NO_PREF = { userId: null, enabled: false };

export function SafeModeProvider({ children }) {
  const userId = getSessionUserId(useContext(AuthContext).session);
  const [pref, setPref] = useState(NO_PREF);
  const [seed] = useState(getSessionSeed);
  const isLoaded = pref.userId === userId;
  const isSafeMode = userId != null && isLoaded && pref.enabled;
  const isReady = userId == null || isLoaded;

  // Keep the module-level flag in sync with state
  useEffect(() => {
    setSafeModeEnabled(isSafeMode, seed);
  }, [isSafeMode, seed]);

  // Load the saved preference whenever a user signs in
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    async function load() {
      let enabled = false;
      try {
        const saved = await getUserPreference(PREF_KEY);
        enabled = saved?.enabled ?? false;
      } catch {
        // Preference could not be read — keep default (off)
      }
      if (cancelled) return;
      // Set the module flag before the state update: marking the preference
      // loaded lets pages render in the same pass, ahead of the effect above.
      setSafeModeEnabled(enabled, seed);
      setPref({ userId, enabled });
    }
    load();
    return () => {
      cancelled = true;
      // Forget this user's preference on sign-out / user change so a later
      // sign-in (even by the same user) waits for a fresh load.
      setPref(NO_PREF);
    };
  }, [userId, seed]);

  const toggleSafeMode = useCallback(async () => {
    const next = !isSafeMode;
    setPref({ userId, enabled: next });
    try {
      await setUserPreference(PREF_KEY, { enabled: next });
    } catch (err) {
      console.error('Failed to persist safe-mode preference:', err);
    }
  }, [isSafeMode, userId]);

  return (
    <SafeModeContext.Provider value={{ isSafeMode, toggleSafeMode, isReady }}>
      {children}
    </SafeModeContext.Provider>
  );
}
