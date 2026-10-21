/**
 * AuthProvider — Phase 6
 *
 * Hoists adapter `getSession()` + `onAuthStateChange` into a single
 * shared context so ProtectedRoute (and anything else that needs the session)
 * can read it without redundant per-route JWT validation round-trips.
 *
 * On first successful auth the provider also:
 *  1. Kicks `pullAll()` (replacing the eager call in App.jsx).
 *  2. Fires `initializeRecurringCycle()`.
 *  3. Starts the online-event sync listener.
 *
 * This means the heavy pull + recurring-init only run once per session start,
 * not on every protected route mount or App re-render.
 */
import { useEffect, useMemo, useState, useRef } from 'react';
import { isSupabaseReady } from '../services/supabase';
import { getSession, onAuthStateChange } from '../services/auth';
import { pullAll, startSyncListener } from '../services/sync';
import { initializeRecurringCycle, PROJECTION_WINDOW_DAYS } from '../services/recurring';
import AuthContext from './authContextValue';

export function AuthProvider({ children, enabled = true }) {
  const [session, setSession] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  const warmedUp = useRef(false);

  useEffect(() => {
    if (!enabled || !isSupabaseReady()) {
      warmedUp.current = false;
      return undefined;
    }

    let mounted = true;

    /**
     * Pre-warm caches and kick background processes exactly once after
     * the first successful auth in this browser session.
     */
    const doWarmUp = () => {
      if (warmedUp.current) return;
      warmedUp.current = true;

      pullAll().catch((err) =>
        console.warn('AuthProvider: initial pull failed:', err?.message || err),
      );
      initializeRecurringCycle({ windowDays: PROJECTION_WINDOW_DAYS }).catch((err) =>
        console.warn('AuthProvider: recurring cycle init failed:', err?.message || err),
      );
      startSyncListener();
    };

    // 1. Check the current session once on mount.
    getSession()
      .then(({ session: nextSession, error }) => {
        if (!mounted) return;
        if (error) console.error('AuthProvider: unable to check session', error);
        const s = nextSession ?? null;
        setSession(s);
        setIsChecking(false);
        if (s) doWarmUp();
      })
      .catch((error) => {
        if (!mounted) return;
        console.error('AuthProvider: session bootstrap failed', error);
        setSession(null);
        setIsChecking(false);
      });

    // 2. Subscribe to auth state changes (sign-in / sign-out / token refresh).
    const unsubscribe = onAuthStateChange((_event, next) => {
      if (!mounted) return;
      setSession(next);
      setIsChecking(false);
      if (next) doWarmUp();
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [enabled]);

  const value = useMemo(() => ({ session, isChecking }), [session, isChecking]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
