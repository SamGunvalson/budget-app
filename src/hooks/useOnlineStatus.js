import { useSyncExternalStore } from "react";

/**
 * Hook that tracks whether the browser is online or offline.
 * Uses `useSyncExternalStore` for tear-free reads across concurrent renders.
 *
 * @returns {boolean} `true` when online
 */

function subscribe(callback) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot() {
  return navigator.onLine;
}

function getServerSnapshot() {
  // During SSR, assume online
  return true;
}

export default function useOnlineStatus() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
