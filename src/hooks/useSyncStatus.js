import { useCallback, useEffect, useState } from "react";
import { onSyncChange, getSyncState } from "../services/sync";
import { pendingCount, onQueueChange } from "../utils/syncQueue";

/**
 * Hook that exposes the current sync status to the UI.
 *
 * Returns:
 *   syncing   — true while a push/pull cycle is in progress
 *   pending   — number of records waiting to be pushed
 *   error     — last sync error message (or null)
 *   progress  — { done, total } for the current push
 */
export default function useSyncStatus() {
  const [state, setState] = useState(() => ({
    ...getSyncState(),
    pending: 0,
  }));

  const refresh = useCallback(async () => {
    const count = await pendingCount();
    const syncState = getSyncState();
    setState({ ...syncState, pending: count });
  }, []);

  useEffect(() => {
    // Initial read
    let cancelled = false;
    (async () => {
      const count = await pendingCount();
      const syncState = getSyncState();
      if (!cancelled) setState({ ...syncState, pending: count });
    })();

    // Listen for sync-engine state changes
    const unsubSync = onSyncChange(() => refresh());
    // Listen for queue additions
    const unsubQueue = onQueueChange(() => refresh());

    return () => {
      cancelled = true;
      unsubSync();
      unsubQueue();
    };
  }, [refresh]);

  return state;
}
