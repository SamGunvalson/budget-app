import { useCallback, useEffect, useState } from 'react';
import { getUserPreferenceOffline as getUserPreference, setUserPreferenceOffline as setUserPreference } from '../services/offlineAware';
import { setSafeModeEnabled } from '../utils/helpers';
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
 * Provides `isSafeMode` and `toggleSafeMode` to the entire app.
 *
 * When safe mode is active the module-level flag in helpers.js is set
 * so that `formatCurrency`, `toDollars`, and `maskAccountName` all
 * return scrambled / masked values without any component refactoring.
 *
 * The preference is persisted to Supabase (`user_preferences`) via
 * the offline-aware layer, identical to the theme preference.
 */
export function SafeModeProvider({ children }) {
  const [isSafeMode, setIsSafeMode] = useState(false);
  const [seed] = useState(getSessionSeed);

  // Keep the module-level flag in sync with state
  useEffect(() => {
    setSafeModeEnabled(isSafeMode, seed);
  }, [isSafeMode, seed]);

  // Load saved preference on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const saved = await getUserPreference(PREF_KEY);
        if (!cancelled && saved != null) {
          setIsSafeMode(saved.enabled ?? false);
        }
      } catch {
        // Preference not found or user not auth'd — keep default (off)
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const toggleSafeMode = useCallback(async () => {
    const next = !isSafeMode;
    setIsSafeMode(next);
    try {
      await setUserPreference(PREF_KEY, { enabled: next });
    } catch (err) {
      console.error('Failed to persist safe-mode preference:', err);
    }
  }, [isSafeMode]);

  return (
    <SafeModeContext.Provider value={{ isSafeMode, toggleSafeMode }}>
      {children}
    </SafeModeContext.Provider>
  );
}
