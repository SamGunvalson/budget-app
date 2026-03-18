import { useCallback, useState } from 'react';
import { getCurrentMonthYear } from '../utils/helpers';
import { MonthYearContext } from './monthYearContextValue';

const STORAGE_KEY = 'selectedMonthYear';

/**
 * Provides `month`, `year`, and `setMonthYear` to the entire app.
 *
 * On mount the provider reads from sessionStorage so the selection
 * survives page navigation. Falls back to the current calendar month.
 */
export function MonthYearProvider({ children }) {
  const fallback = getCurrentMonthYear();

  const [month, setMonth] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved).month;
    } catch { /* ignore */ }
    return fallback.month;
  });

  const [year, setYear] = useState(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved).year;
    } catch { /* ignore */ }
    return fallback.year;
  });

  const setMonthYear = useCallback((m, y) => {
    setMonth(m);
    setYear(y);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ month: m, year: y }));
    } catch (err) {
      console.error('Failed to persist month/year to sessionStorage:', err);
    }
  }, []);

  return (
    <MonthYearContext.Provider value={{ month, year, setMonthYear }}>
      {children}
    </MonthYearContext.Provider>
  );
}
