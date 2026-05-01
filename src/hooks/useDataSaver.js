import { useSyncExternalStore } from "react";

/**
 * Phase 7 — Data-saver detection.
 *
 * Returns `true` when the user or device has indicated that background data
 * usage should be minimised.  Checks (in order):
 *
 *  1. `navigator.connection.saveData`    — Android / Chrome data-saver toggle.
 *  2. CSS `prefers-reduced-data: reduce` — emerging media query (spec stage).
 *  3. `navigator.connection.effectiveType` — treats "slow-2g" and "2g" as
 *     "metered enough to conserve."
 *
 * The hook is tear-free across concurrent renders via `useSyncExternalStore`.
 */

function getSnapshot() {
  // 1. Explicit save-data flag
  const conn =
    navigator.connection ??
    navigator.mozConnection ??
    navigator.webkitConnection;
  if (conn?.saveData) return true;

  // 2. CSS media query (spec-stage; supported in limited browsers)
  if (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-data: reduce)").matches
  ) {
    return true;
  }

  // 3. Very slow effective connection type
  if (conn?.effectiveType === "slow-2g" || conn?.effectiveType === "2g") {
    return true;
  }

  return false;
}

function getServerSnapshot() {
  return false;
}

function subscribe(callback) {
  const conn =
    navigator.connection ??
    navigator.mozConnection ??
    navigator.webkitConnection;

  // NetworkInformation fires 'change' when effectiveType or saveData changes.
  if (conn) {
    conn.addEventListener("change", callback);
  }

  // Listen to the media query too, in case it becomes dynamically toggleable.
  let mql;
  if (typeof matchMedia === "function") {
    mql = matchMedia("(prefers-reduced-data: reduce)");
    mql.addEventListener("change", callback);
  }

  return () => {
    if (conn) conn.removeEventListener("change", callback);
    if (mql) mql.removeEventListener("change", callback);
  };
}

export default function useDataSaver() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Non-hook version for use in service/utility code (sync.js, cache.js)
 * that runs outside a React render cycle.
 */
export function isDataSaver() {
  return getSnapshot();
}
