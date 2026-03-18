import { useCallback, useEffect, useState } from 'react';
import { getUserPreferenceOffline as getUserPreference, setUserPreferenceOffline as setUserPreference } from '../services/offlineAware';
import { ThemeContext } from './themeContextValue';

const PREF_KEY = 'theme';

/**
 * Provides `isDark` and `toggleTheme` to the entire app.
 *
 * Default is dark mode. On mount the provider:
 *  1. Applies the `dark` class on <html> immediately (so first paint is dark).
 *  2. Loads the saved preference from Supabase and reconciles.
 *
 * Toggling persists the choice to Supabase so it syncs across devices.
 */
export function ThemeProvider({ children }) {
  const [isDark, setIsDark] = useState(true); // dark by default

  // Keep the `dark` class in sync with state
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  // Load saved preference on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const saved = await getUserPreference(PREF_KEY);
        if (!cancelled && saved != null) {
          // saved is { dark: boolean }
          setIsDark(saved.dark ?? true);
        }
      } catch {
        // Preference not found or user not auth'd — keep default (dark)
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const toggleTheme = useCallback(async () => {
    const next = !isDark;
    setIsDark(next);
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
