/**
 * Cache layer (Phase 1 — cache-first reads).
 *
 * Provides three building blocks used by the offline-aware service wrappers:
 *
 *  1. **`swrRead`** — stale-while-revalidate read helper.
 *     Reads the local Dexie cache and returns it immediately when present.
 *     In parallel, fetches fresh data from the origin (Supabase), updates the
 *     cache, and notifies subscribers. When the cache is empty (cold) the
 *     fetch is awaited so callers always get *some* data on first paint.
 *
 *  2. **Table change events** (`subscribeTable` / `notifyTable`) — a tiny pub/
 *     sub so consumers (or, in Phase 2, React Query) can react when a
 *     background revalidation has updated a table.
 *
 *  3. **Revalidating flag** (`subscribeRevalidating` / `getRevalidating`) —
 *     exposes a global "are we currently revalidating in the background?"
 *     boolean that the TopBar shows as a small "Refreshing…" pill. Internally
 *     it's a counter so concurrent revalidations don't race the indicator.
 *
 * Design notes
 * ────────────
 *  - The cache is authoritative for the UI, the network is authoritative for
 *    correctness. We accept showing data that is up to a few seconds stale on
 *    the same tab (and longer on other tabs — multi-tab fanout is a Phase 2
 *    concern, see docs/performance/PHASE_1_CACHE_FIRST.md).
 *  - Background fetch errors are *swallowed* (logged at debug level) so a
 *    flaky network never breaks UI. The original network-first code did
 *    rethrow on non-network errors; for SWR reads we deliberately don't —
 *    the user is already looking at cached data.
 *  - Mutations stay in the existing offlineAware/sync paths and call
 *    `notifyTable` directly so the indicator doesn't lie.
 */

// ── Table change pub/sub ──

const tableListeners = new Map(); // table → Set<fn>

export function subscribeTable(table, fn) {
  let set = tableListeners.get(table);
  if (!set) {
    set = new Set();
    tableListeners.set(table, set);
  }
  set.add(fn);
  return () => set.delete(fn);
}

export function notifyTable(table) {
  const set = tableListeners.get(table);
  if (!set || set.size === 0) return;
  // Fire asynchronously so notify() can be called inside a transaction
  // without holding listeners up.
  queueMicrotask(() => {
    for (const fn of set) {
      try {
        fn(table);
      } catch (err) {
        // Listener bugs must not break the cache layer.
        console.warn(`[cache] table listener for ${table} threw:`, err);
      }
    }
  });
}

// ── Revalidating indicator (counter-backed boolean) ──

let _revalidatingCount = 0;
const revalidatingListeners = new Set();

function emitRevalidating() {
  const value = _revalidatingCount > 0;
  queueMicrotask(() => {
    for (const fn of revalidatingListeners) {
      try {
        fn(value);
      } catch (err) {
        console.warn("[cache] revalidating listener threw:", err);
      }
    }
  });
}

export function getRevalidating() {
  return _revalidatingCount > 0;
}

export function subscribeRevalidating(fn) {
  revalidatingListeners.add(fn);
  return () => revalidatingListeners.delete(fn);
}

function beginRevalidate() {
  _revalidatingCount++;
  if (_revalidatingCount === 1) emitRevalidating();
}

function endRevalidate() {
  _revalidatingCount = Math.max(0, _revalidatingCount - 1);
  if (_revalidatingCount === 0) emitRevalidating();
}

// ── In-flight de-duplication ──
// If a swrRead with the same key is already revalidating, we piggy-back on it
// rather than starting a second identical Supabase request.
const inflight = new Map(); // key → Promise

// ── The SWR read helper ──

/**
 * Stale-while-revalidate read.
 *
 * @template T
 * @param {Object} opts
 * @param {string} opts.key
 *   Unique identifier for the read (used for in-flight de-duplication).
 *   Convention: `"<table>:<filterRepr>"`, e.g. `"transactions:m=4y=2026"`.
 * @param {() => Promise<T>} opts.readCache
 *   Reads the current value from Dexie and returns it. Should never throw —
 *   return an "empty" value instead (e.g. `[]` or `null`).
 * @param {() => Promise<T>} opts.fetchFresh
 *   Fetches the authoritative value from the origin (Supabase). May throw.
 * @param {(data: T) => Promise<void>} opts.writeCache
 *   Persists fresh data back to Dexie. Errors here are logged but not thrown.
 * @param {string} [opts.table]
 *   Optional table name; when provided, `notifyTable(table)` is called after
 *   a successful revalidation.
 * @param {(data: T) => boolean} [opts.isEmpty]
 *   Override for "is the cache empty?" detection. Defaults to:
 *   `null/undefined` → empty, `Array.length === 0` → empty, otherwise present.
 * @param {boolean} [opts.online=navigator.onLine]
 *   Whether we should attempt the background fetch at all.
 * @returns {Promise<T>} The cached value (or the fresh value when cache is
 *   empty / offline). Callers receive the freshest data we have *right now*;
 *   subsequent updates flow through `subscribeTable`.
 */
export async function swrRead({
  key,
  readCache,
  fetchFresh,
  writeCache,
  table,
  isEmpty = defaultIsEmpty,
  online = typeof navigator !== "undefined" ? navigator.onLine : true,
}) {
  // Always start with the cache — this is the latency win.
  let cached;
  try {
    cached = await readCache();
  } catch (err) {
    console.warn(`[cache] readCache for ${key} failed:`, err);
    cached = null;
  }

  const haveCached = !isEmpty(cached);

  // Offline → return whatever the cache has (possibly empty). No network.
  if (!online) return cached;

  // Cold cache → await the fresh fetch so the caller has data to render.
  if (!haveCached) {
    try {
      const fresh = await dedupedFetch(key, fetchFresh);
      // Write back to cache (best-effort) and notify.
      try {
        await writeCache(fresh);
      } catch (err) {
        console.warn(`[cache] writeCache for ${key} failed:`, err);
      }
      if (table) notifyTable(table);
      return fresh;
    } catch (err) {
      // Network failed and we have nothing cached — surface the empty cache
      // to keep the UI rendering. Errors are logged but not thrown so a flaky
      // network never breaks the UI; mutations / explicit refreshes will
      // still report errors via their own paths.
      console.warn(`[cache] fetchFresh for ${key} failed (cold):`, err);
      return cached;
    }
  }

  // Warm cache → return immediately, revalidate in background.
  beginRevalidate();
  dedupedFetch(key, fetchFresh)
    .then(async (fresh) => {
      try {
        await writeCache(fresh);
      } catch (err) {
        console.warn(`[cache] writeCache for ${key} failed:`, err);
      }
      if (table) notifyTable(table);
    })
    .catch((err) => {
      // Background failures are non-fatal — the user is looking at cached data.
      console.debug(`[cache] background fetchFresh for ${key} failed:`, err);
    })
    .finally(endRevalidate);

  return cached;
}

function defaultIsEmpty(value) {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function dedupedFetch(key, fetchFresh) {
  const existing = inflight.get(key);
  if (existing) return existing;
  const promise = Promise.resolve()
    .then(fetchFresh)
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}
