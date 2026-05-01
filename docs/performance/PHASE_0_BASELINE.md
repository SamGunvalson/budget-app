# Phase 0 — Performance Baseline

**Goal:** capture defensible before-numbers so every later phase can be measured
against a real baseline. No behaviour changes.

**Status:** 🟡 instrumentation landed; numbers TBD by tester.

---

## What landed

| Change | File | Notes |
|---|---|---|
| `rollup-plugin-visualizer` (dev dep) + `npm run build:analyze` script | [package.json](../../package.json), [vite.config.js](../../vite.config.js) | Emits `dist/stats.html` treemap when `ANALYZE=1`. |
| Lightweight perf helper (`perfStart`, `perfAsync`, `perfRecord`) | [src/utils/perf.js](../../src/utils/perf.js) | No-op unless `import.meta.env.DEV`, `?perf=1`, or `localStorage.perf === '1'`. |
| Supabase client wrapper that records `db:<table>:<verb>` per query | [src/services/supabase.js](../../src/services/supabase.js) | Hooks the query builder's `then`. |
| Cold-boot mark (`boot:cold`) | [src/main.jsx](../../src/main.jsx) | Module-eval → first commit (resolved on the second `requestAnimationFrame`). |
| Route-change marks (`route:<pathname>`) | [src/App.jsx](../../src/App.jsx) | One per `useLocation()` change. |

No production user is affected — the helper is a no-op without explicit opt-in.

---

## How to take a baseline reading

1. **Build the production bundle** and serve it locally:

   ```bash
   npm run build:analyze && npm run preview -- --host
   ```

   Open `dist/stats.html` in a browser and screenshot the treemap.

2. **Cold-load timings** — open the preview URL with `?perf=1` in a fresh
   incognito window (so service-worker + IndexedDB are empty), wait for the
   app to settle, then in DevTools console:

   ```js
   window.__perf.summary();
   ```

   Record the `boot:cold` row and the top 10 `db:*` rows.

3. **Warm-load timings** — reload the same tab (service worker + Dexie are now
   populated) and capture `summary()` again.

4. **Route-nav timings** — click through the canonical loop:

   `Transactions → Budgets → Accounts → Reports → Settings → Splits → Transactions`

   Then run `summary()` and copy the `route:*` rows.

5. **DevTools Performance trace** — record the same loop with the
   Performance panel; export the profile JSON. Save under
   `docs/performance/traces/phase0-<scenario>.json` (gitignored if you'd
   rather not commit them).

---

## Baseline numbers

> Fill in once measurements are taken. Use the tables below verbatim — later
> phases will diff against these rows.

### Bundle (gzip, from `dist/stats.html`)

| Chunk | Size (gzip) | Notes |
|---|---:|---|
| _initial route_ | _TBD_ | sum of `index.html` + entry + critical chunks |
| `vendor` | _TBD_ | react / react-dom / react-router |
| `charts` (recharts) | _TBD_ | |
| `excel` (exceljs) | _TBD_ | |
| `supabase` | _TBD_ | |
| `dnd` (dnd-kit) | _TBD_ | |
| `utils` (date-fns / dexie) | _TBD_ | |
| **Total** | _TBD_ | |

### Cold load (incognito, empty cache)

| Metric | Value |
|---|---:|
| `boot:cold` | _TBD_ ms |
| Top `db:*` p90 | _TBD_ ms (label) |
| Sum of `db:*` durations during boot | _TBD_ ms |
| Largest Contentful Paint | _TBD_ ms |

(index)
label
count
p50
p90
p99
max
0	'route:/app'	1	12.8	12.8	12.8	12.8
1	'route:/app/transactions'	1	11.9	11.9	11.9	11.9
2	'boot:cold'	1	7.4	7.4	7.4	7.4
3	'route:/auth'	1	6	6	6	6
4	'route:/'	1	2.5	2.5	2.5	2.5
### Warm load (cache populated)

| Metric | Value |
|---|---:|
| `boot:cold` | _TBD_ ms |
| Sum of `db:*` durations during boot | _TBD_ ms |

### Route navigation

| Route | p50 | p90 |
|---|---:|---:|
| `route:/app/transactions` | _TBD_ | _TBD_ |
| `route:/app/budgets` | _TBD_ | _TBD_ |
| `route:/app/accounts` | _TBD_ | _TBD_ |
| `route:/app/reports` | _TBD_ | _TBD_ |
| `route:/app/settings` | _TBD_ | _TBD_ |
| `route:/app/splits` | _TBD_ | _TBD_ |

### Network round-trips per route (warm)

| Route | # `db:*` calls | Notes |
|---|---:|---|
| `/app/transactions` | _TBD_ | from `summary()` count |
| `/app/budgets` | _TBD_ | |
| `/app/accounts` | _TBD_ | |
| `/app/reports` | _TBD_ | |
| `/app/settings` | _TBD_ | |
| `/app/splits` | _TBD_ | |

---

## Acceptance criteria for Phase 0

- [x] Instrumentation present in build, off by default in production.
- [x] `npm run build:analyze` produces a treemap.
- [x] `npm run lint` passes.
- [ ] Baseline numbers above are filled in for at least one device profile
      (desktop Chrome). Mobile profile optional but recommended.

Once the baseline rows are populated, Phase 0 is complete and Phase 1 may
start. Each subsequent phase will append a "before / after" diff to its own
doc using these rows as the "before" column.

---

## Notes for testers

- The perf helper trims its in-memory buffer at 500 entries. For long sessions,
  call `window.__perf.reset()` between scenarios so percentiles aren't skewed.
- `db:<table>:<verb>` labels include the verb only when one of `select`,
  `insert`, `update`, `upsert`, or `delete` is called on the builder. Other
  patterns (e.g. raw RPCs) report as `db:<table>:query`.
- Errors are recorded as `db:<table>:<verb>:error` so timeouts are visible
  separately.
