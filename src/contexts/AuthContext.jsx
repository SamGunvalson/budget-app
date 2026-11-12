/**
 * AuthProvider — Phase 6
 *
 * Hoists adapter `getSession()` + `onAuthStateChange` into a single
 * shared context so ProtectedRoute (and anything else that needs the session)
 * can read it without redundant per-route JWT validation round-trips.
 *
 * On first successful auth the provider also:
 *  1. Kicks `requestSync()` — pushes changes still queued from a previous
 *     session, then pulls (replacing the eager pull in App.jsx).
 *  2. Fires `initializeRecurringCycle()`.
 *  3. Starts the online-event sync listener.
 *
 * This means the heavy pull + recurring-init only run once per signed-in user,
 * not on every protected route mount, token refresh, or App re-render.
 *
 * Per-user resets all hang off one place, `noteSessionIdentity()`: whenever
 * the session becomes null or the user id changes, the previous user's React
 * Query cache is dropped and the warm-up is re-armed for the next user.
 * Theme/safe-mode providers key their own state on the same user id.
 */
import { useEffect, useMemo, useState } from 'react';
import { isSupabaseReady } from '../services/supabase';
import { getSession, onAuthStateChange } from '../services/auth';
import { requestSync, startSyncListener } from '../services/sync';
import { initializeRecurringCycle, PROJECTION_WINDOW_DAYS } from '../services/recurring';
import AuthContext, { classifySessionChange, getSessionUserId } from './authContextValue';
import { resetQueryCacheForSessionChange } from '../services/queryClient';

// Module-level on purpose: the identity we last acted on must survive an
// AuthProvider remount (server change on /setup), so the previous user's
// state is still reset when the new backend reports a different session.
let lastUserId = null;
// `startSyncListener` adds window/document listeners on every call, so it
// must run at most once per page load however many users sign in.
let syncListenerStarted = false;

/** Pre-warm caches and kick background processes for a newly signed-in user. */
function warmUp() {
  // Push first: rows queued in an earlier session must not wait for an
  // online / visibility event. With an empty queue this is just the pull.
  requestSync().catch((err) =>
    console.warn('AuthProvider: initial sync failed:', err?.message || err),
  );
  initializeRecurringCycle({ windowDays: PROJECTION_WINDOW_DAYS }).catch((err) =>
    console.warn('AuthProvider: recurring cycle init failed:', err?.message || err),
  );
  if (!syncListenerStarted) {
    syncListenerStarted = true;
    startSyncListener();
  }
}

/**
 * The single "session became null or user id changed" hook. Same-user events
 * (token refresh, duplicate initial-session notifications) are no-ops.
 */
function noteSessionIdentity(session) {
  const nextUserId = getSessionUserId(session);
  const change = classifySessionChange(lastUserId, nextUserId);
  lastUserId = nextUserId;
  if (change === 'none') return;

  resetQueryCacheForSessionChange(change);
  if (nextUserId) warmUp();
}

export function AuthProvider({ children, enabled = true }) {
  const [session, setSession] = useState(null);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    if (!enabled || !isSupabaseReady()) return undefined;

    let mounted = true;

    const applySession = (next) => {
      noteSessionIdentity(next);
      setSession(next);
      setIsChecking(false);
    };

    // 1. Check the current session once on mount.
    getSession()
      .then(({ session: nextSession, error }) => {
        if (!mounted) return;
        if (error) console.error('AuthProvider: unable to check session', error);
        applySession(nextSession ?? null);
      })
      .catch((error) => {
        if (!mounted) return;
        console.error('AuthProvider: session bootstrap failed', error);
        applySession(null);
      });

    // 2. Subscribe to auth state changes (sign-in / sign-out / token refresh).
    const unsubscribe = onAuthStateChange((_event, next) => {
      if (!mounted) return;
      applySession(next ?? null);
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [enabled]);

  const value = useMemo(() => ({ session, isChecking }), [session, isChecking]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
