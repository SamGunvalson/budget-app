# Performance plan

This directory tracks the multi-phase effort to investigate and improve UI/UX
performance and data-loading latency across the app. Each phase is shipped
independently; later phases assume earlier ones are in place.

## Phases

| Phase | Title                                                       | Status     | Doc                                                                |
| ----- | ----------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| 1     | Cache-first reads + incremental sync                        | ✅ Shipped | [PHASE_1_CACHE_FIRST.md](./PHASE_1_CACHE_FIRST.md)                 |
| 2     | React Query adoption + multi-tab fanout                     | ✅ Shipped | [PHASE_2_REACT_QUERY.md](./PHASE_2_REACT_QUERY.md)                 |
| 3     | Server-side aggregations (Postgres views/RPCs)              | ✅ Shipped | [PHASE_3_SERVER_AGGREGATIONS.md](./PHASE_3_SERVER_AGGREGATIONS.md) |
| 4     | Mutation batching + write-path cleanup                      | ✅ Shipped | [PHASE_4_MUTATIONS.md](./PHASE_4_MUTATIONS.md)                     |
| 5     | Bundle splitting + lazy-load heavy deps (exceljs, recharts) | ✅ Shipped | [PHASE_5_RENDER_BUNDLE.md](./PHASE_5_RENDER_BUNDLE.md)             |
| 6     | Virtualization + render-cost audit                          | Planned    | _tbd_                                                              |
| 7     | Service worker / runtime cache strategy review              | Planned    | _tbd_                                                              |
| 8     | Observability: web-vitals, real-user metrics                | Planned    | _tbd_                                                              |

## Confirmed design decisions (apply to all phases)

| #   | Decision                                                                                                                           | Rationale                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Cache-first / SWR for reads** (return Dexie immediately, revalidate in background).                                              | The Dexie cache is already faithful to the Supabase schema; serving it first eliminates the network round-trip from page nav. |
| 2   | **Adopt `@tanstack/react-query`** in Phase 2 as the L1 cache + invalidation bus.                                                   | Gives us de-dup, refetch-on-focus, and a clean place to invalidate on mutations without re-inventing a Flux.                  |
| 3   | **Per-table watermark** (`sync_meta.last_synced` + `.gt('updated_at', last_synced)`) with **last-write-wins** conflict resolution. | Matches existing soft-delete + `updated_at`-on-write patterns. Cheap to implement, correct enough for a single-user app.      |
| 4   | **Server-side aggregations as `SECURITY INVOKER` Postgres functions/views** (Phase 3).                                             | Keeps RLS in force without re-implementing it in SQL.                                                                         |

## Non-goals (for now)

- Real-time subscriptions via Supabase Realtime (deferred to Phase 2 or later).
- Multi-device conflict UI ("you have unsynced changes from another device").
  Phase 1's "newest `updated_at` wins" silently overwrites — acceptable for a
  single-user budget app where the same data is rarely edited from two devices
  simultaneously.
