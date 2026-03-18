import { useState, useEffect } from 'react';
import { getTransactionYears } from '../services/transactions';

/**
 * Fetches all years that have at least one transaction, plus the next calendar
 * year so users can budget ahead.  Falls back to a ±3 year window around the
 * current year while loading or if the query fails.
 *
 * @returns {{ years: number[], isLoading: boolean }}
 */
export default function useAvailableYears() {
  const currentYear = new Date().getFullYear();
  const fallback = Array.from({ length: 7 }, (_, i) => currentYear - 3 + i);

  const [years, setYears] = useState(fallback);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const result = await getTransactionYears();
        if (!cancelled && result.length > 0) {
          setYears(result);
        }
      } catch {
        // Keep fallback on error
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return { years, isLoading };
}
