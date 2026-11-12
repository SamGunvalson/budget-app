import { useCallback, useContext, useEffect, useState } from 'react';
import { getUserPreferenceOffline as getUserPreference, setUserPreferenceOffline as setUserPreference } from '../services/offlineAware';
import AuthContext, { getSessionUserId } from './authContextValue';
import { ThemeContext } from './themeContextValue';

const PREF_KEY = 'theme';

// Last theme shown on this device. Not user data: it only seeds the first
// paint (and the sign-in page) until the signed-in user's preference loads.
const LAST_KNOWN_KEY = 'theme_last_known';

function readLastKnownDark() {
  try {
    return localStorage.getItem(LAST_KNOWN_KEY) !== 'light'; // dark by default
  } catch {
    return true; // storage unavailable
  }
}

function rememberDark(dark) {
  try {
    localStorage.setItem(LAST_KNOWN_KEY, dark ? 'dark' : 'light');
  } catch { /* storage unavailable */ }
}

/**
 * Provides `isDark` and `toggleTheme` to the entire app.
 *
 * Default is dark mode. The provider:
 *  1. Starts from the last theme shown on this device (localStorage), so the
 *     first paint and the sign-in page match what the user last saw.
 *  2. Loads the saved preference for the signed-in user — re-read after every
 *     sign-in — and that always wins once it resolves (no saved preference
 *     means the default, dark). Must render below <AuthProvider>.
 *
 * Signing out keeps the current theme rather than forcing the default.
 * Toggling persists the choice to Supabase so it syncs across devices.
 */
export function ThemeProvider({ children }) {
  const userId = getSessionUserId(useContext(AuthContext).session);
  const [isDark, setIsDark] = useState(readLastKnownDark);

  // Keep the `dark` class in sync with state
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Load the saved preference whenever a user signs in
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    async function load() {
      try {
        const saved = await getUserPreference(PREF_KEY);
        if (cancelled) return;
        // saved is { dark: boolean }, or null when this user never chose
        const dark = saved?.dark ?? true;
        setIsDark(dark);
        rememberDark(dark);
      } catch {
        // Preference could not be read — keep the last-known theme
      }
    }
    load();
    return () => { cancelled = true; };
  }, [userId]);

  const toggleTheme = useCallback(async () => {
    const next = !isDark;
    setIsDark(next);
    rememberDark(next);
    try {
      await setUserPreference(PREF_KEY, { dark: next });
    } catch (err) {
      console.error('Failed to persist theme preference:', err);
      // State already updated — worst case it won't survive a re-login
    }
  }, [isDark]);

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
