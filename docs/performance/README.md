# Performance reference

Completed implementation plans are in the [performance archive](../archive/README.md#performance-records). They explain earlier decisions, not current installation commands.

## Current implementation surfaces

| Concern | Current code |
| --- | --- |
| Cache-first reads and incremental pulls | [Offline wrappers](../../src/services/offlineAware.js), [cache](../../src/services/cache.js), [sync](../../src/services/sync.js) |
| Query deduplication and table invalidation | [Query hooks](../../src/hooks/queries.js), [query client](../../src/services/queryClient.js), [bridge](../../src/services/queryBridge.js) |
| Server aggregations and batched writes | [Aggregation SQL](../../sql_scripts/supabase_phase3_aggregations.sql), [mutation SQL](../../sql_scripts/supabase_phase4_mutations.sql) |
| Lazy routes/chunks and runtime caching | [App](../../src/App.jsx), [Vite/PWA configuration](../../vite.config.js) |
| Transaction-list virtualization | [TransactionList](../../src/components/transactions/TransactionList.jsx) |
| Opt-in timing helpers | [Performance helpers](../../src/utils/perf.js) |

Virtualization and runtime-cache strategy code already exist; the old roadmap's
"planned" labels for phases 6/7 are not accurate descriptions of an untouched
implementation. Their presence does not establish that a full render-cost or
cache-strategy audit was completed.

## Remaining measurement work

- Capture reproducible cold/warm load, navigation, and large-list measurements.
- Evaluate render cost and service-worker behavior on real devices and constrained networks.
- Decide whether web-vitals/real-user metrics are needed. The existing opt-in
  timing helper is not a real-user monitoring service.

The old baseline mentions `build:analyze` and a visualizer dependency that are
not in the current manifest. Use the available helpers/browser tools instead;
do not treat historical commands as supported.

For database prerequisites, use the [setup guide](../SETUP_GUIDE.md), not phase plans.
