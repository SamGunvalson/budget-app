import { useState, useCallback } from "react";

/**
 * Like useState, but the value is backed by sessionStorage so it survives
 * in-tab navigation (component unmount/remount) while still resetting when
 * the browser tab is closed.
 *
 * @param {string} storageKey   - sessionStorage key to read/write
 * @param {*}      defaultValue - value to use when nothing is in storage
 * @returns {[*, Function]}     - [value, setValue] identical to useState
 */
export default function useSessionState(storageKey, defaultValue) {
  const [value, setValueInternal] = useState(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  const setValue = useCallback(
    (newValue) => {
      setValueInternal((prev) => {
        const next = typeof newValue === "function" ? newValue(prev) : newValue;
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // sessionStorage unavailable — silently fall back to in-memory state
        }
        return next;
      });
    },
    [storageKey],
  );

  return [value, setValue];
}
