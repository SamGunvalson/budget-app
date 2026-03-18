import { useContext } from 'react';
import { MonthYearContext } from '../contexts/monthYearContextValue';

/**
 * Returns `{ month: number, year: number, setMonthYear: (m, y) => void }`.
 *
 * Must be used inside `<MonthYearProvider>`.
 */
export default function useMonthYear() {
  const ctx = useContext(MonthYearContext);
  if (!ctx) {
    throw new Error('useMonthYear must be used within a <MonthYearProvider>');
  }
  return ctx;
}
