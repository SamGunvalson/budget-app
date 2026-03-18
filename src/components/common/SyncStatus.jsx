import useOnlineStatus from '../../hooks/useOnlineStatus';
import useSyncStatus from '../../hooks/useSyncStatus';
import { requestSync } from '../../services/sync';

/**
 * Compact status indicator for the TopBar.
 *
 * States:
 * - Offline (red dot + "Offline")
 * - Syncing (amber spinner + "Syncing…")
 * - Pending (amber dot + "X pending")
 * - Online (green dot, no text — hidden by default)
 * - Error (red dot + "Sync error")
 */
export default function SyncStatus() {
  const online = useOnlineStatus();
  const { syncing, pending, error, progress } = useSyncStatus();

  // Offline state
  if (!online) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        Offline
        {pending > 0 && (
          <span className="ml-0.5 tabular-nums">· {pending}</span>
        )}
      </div>
    );
  }

  // Syncing state
  if (syncing) {
    return (
      <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="tabular-nums">
          Syncing{progress.total > 0 ? `… ${progress.done}/${progress.total}` : '…'}
        </span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <button
        type="button"
        onClick={() => requestSync()}
        title={error}
        className="flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
      >
        <span className="relative flex h-2 w-2">
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        Sync error · retry
      </button>
    );
  }

  // Pending (online but queued items exist)
  if (pending > 0) {
    return (
      <button
        type="button"
        onClick={() => requestSync()}
        className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
      >
        <span className="relative flex h-2 w-2">
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
        <span className="tabular-nums">{pending} pending</span>
      </button>
    );
  }

  // All clear — show a subtle green dot
  return (
    <div className="flex items-center gap-1.5 rounded-lg px-1.5 py-1.5" title="All synced">
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </div>
  );
}
