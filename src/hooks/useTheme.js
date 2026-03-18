import { useContext } from 'react';
import { ThemeContext } from '../contexts/themeContextValue';

/**
 * Returns `{ isDark: boolean, toggleTheme: () => Promise<void> }`.
 *
 * Must be used inside `<ThemeProvider>`.
 */
export default function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return ctx;
}
