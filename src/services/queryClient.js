/**
 * Single shared `QueryClient` for the app (Phase 2 — react-query L1 cache).
 *
 * Tuned for our cache-first / SWR data model (see Phase 1):
 *
 *  - `queryFn`s are thin adapters around `services/offlineAware.js` reads,
 *    which already serve from Dexie immediately and revalidate in the
 *    background. So from react-query's point of view, queries almost always
 *    "complete" within microseconds (cached path) and we only really pay the
 *    network cost on a cold cache.
 *
 *  - `staleTime: 5min` matches the previous polling interval so we don't
 *    refetch on every component remount; bridged invalidations from
 *    `services/cache.js#notifyTable` and `services/sync.js#pullAll` keep
 *    queries fresh without time-based polling.
 *
 *  - `gcTime: 30min` keeps recently-used query data warm for tab-switching.
 *
 *  - `refetchOnWindowFocus: false` — focus refetch would defeat the SWR
 *    design; we already revalidate on `online` events and on every
 *    cache-first read.
 *
 *  - `retry: 1` — the SWR layer already swallows transient errors; the
 *    single retry catches a one-off blip without making error UX laggy.
 */
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});
