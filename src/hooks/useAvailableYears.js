import { useTransactionYears } from "./queries";

/**
 * Fetches all years that have at least one transaction, plus the next calendar
 * year so users can budget ahead.  Falls back to a ±3 year window around the
 * current year while loading or if the query fails.
 *
 * Phase 3: backed by the `get_transaction_years` Postgres RPC via
 * `useTransactionYears` (cache-first + auto-invalidating on transaction
 * mutations through the query bridge).
 *
 * @returns {{ years: number[], isLoading: boolean }}
 */
export default function useAvailableYears() {
  const currentYear = new Date().getFullYear();
  const fallback = Array.from({ length: 7 }, (_, i) => currentYear - 3 + i);

  const { data, isLoading, error } = useTransactionYears();
  const years =
    !error && Array.isArray(data) && data.length > 0 ? data : fallback;

  return { years, isLoading };
}
