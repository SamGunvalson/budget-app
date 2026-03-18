import { useState, useEffect, useCallback } from "react";
import {
  getUserPreferenceOffline as getUserPreference,
  setUserPreferenceOffline as setUserPreference,
} from "../services/offlineAware";
import { DEFAULT_THRESHOLDS } from "../utils/budgetCalculations";

const PREF_KEY = "budget_thresholds";

/**
 * Hook to load, cache, and persist the user's budget-alert thresholds.
 *
 * @returns {{
 *   thresholds: { warning: number, danger: number },
 *   setThresholds: (t: { warning: number, danger: number }) => Promise<void>,
 *   resetThresholds: () => Promise<void>,
 *   isLoading: boolean,
 *   error: string,
 * }}
 */
export default function useThresholds() {
  const [thresholds, setLocal] = useState(DEFAULT_THRESHOLDS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  // Load once on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const saved = await getUserPreference(PREF_KEY);
        if (!cancelled && saved) {
          setLocal({
            underBudget: saved.underBudget ?? DEFAULT_THRESHOLDS.underBudget,
            warning: saved.warning ?? DEFAULT_THRESHOLDS.warning,
            danger: saved.danger ?? DEFAULT_THRESHOLDS.danger,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load thresholds");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Save custom thresholds to Supabase + update local state. */
  const setThresholds = useCallback(async (next) => {
    setError("");
    try {
      await setUserPreference(PREF_KEY, next);
      setLocal(next);
    } catch (err) {
      setError(err.message || "Failed to save thresholds");
      throw err; // let callers handle UI feedback
    }
  }, []);

  /** Reset to factory defaults. */
  const resetThresholds = useCallback(async () => {
    await setThresholds(DEFAULT_THRESHOLDS);
  }, [setThresholds]);

  return { thresholds, setThresholds, resetThresholds, isLoading, error };
}
