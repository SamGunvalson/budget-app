/**
 * Sync engine — pushes offline-queued mutations to Supabase when online,
 * then pulls fresh data via an *incremental* watermark per table.
 *
 * Flow:
 * 1. Listen for `online` events.
 * 2. On coming online (or manual trigger), read all `_offline === 1` records
 *    from IndexedDB via the syncQueue.
 * 3. Replay each mutation to Supabase (create → insert, update → update,
 *    delete → soft-delete or deactivate).
 * 4. On success, clear the offline flags.
 * 5. After all mutations succeed, pull fresh data from Supabase → IndexedDB
 *    using each table's `sync_meta.last_synced` watermark so we only fetch
 *    rows whose `updated_at` is newer.
 *
 * Conflict strategy: last-write-wins (offline timestamp vs server updated_at).
 *
 * Phase 1 changes:
 *  - `pullAll` is now incremental by default. Cold caches still do a full
 *    pull (no watermark recorded yet → fetches everything since 1970).
 *  - The 5-minute polling interval was removed; revalidation now happens
 *    cache-first per read (see `services/cache.js`) and on `online` events.
 *  - Each successful per-table pull notifies subscribers via
 *    `notifyTable(tableName)` so consumers can react when fresh data lands.
 */
import { supabase, getCurrentUser } from "./supabase";
import {
  markSynced,
  adoptServerRow,
  cacheTable,
  cacheTableIncremental,
  dropUnchangedRows,
  getTableLastSynced,
  getTableRowCount,
} from "./offlineDb";
import { drainAll } from "../utils/syncQueue";
import { notifyTable } from "./cache";
import { isDataSaver } from "../hooks/useDataSaver";

// ── Sync state (observable) ──
let _syncing = false;
let _lastError = null;
let _syncProgress = { done: 0, total: 0 };
const _listeners = new Set();

export function onSyncChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  queueMicrotask(() =>
    _listeners.forEach((fn) =>
      fn({
        syncing: _syncing,
        error: _lastError,
        progress: { ..._syncProgress },
      }),
    ),
  );
}

export function getSyncState() {
  return {
    syncing: _syncing,
    error: _lastError,
    progress: { ..._syncProgress },
  };
}

// ── Public API ──

/**
 * Run a full sync cycle: push pending offline changes, then pull fresh data.
 * Safe to call repeatedly — concurrent calls are coalesced.
 */
let _syncPromise = null;

export function requestSync({ skipPull = false } = {}) {
  if (_syncPromise) return _syncPromise;
  _syncPromise = _doSync({ skipPull }).finally(() => {
    _syncPromise = null;
  });
  return _syncPromise;
}

// ── Scheduled push ──
//
// A write that is queued while the app is online (its row was still pending,
// or the backend call failed mid-flight) must not wait for the next `online`
// or tab-visibility event. `schedulePush` coalesces a burst of such writes
// into one push-only sync shortly afterwards.
const PUSH_DEBOUNCE_MS = 1500;
// After a push that failed, wait this long before a scheduled retry so a
// row the server keeps rejecting (or an unreachable server) cannot turn
// every local write into another round of failing requests.
const PUSH_RETRY_MS = 30_000;
let _pushTimer = null;
let _lastPushErrorAt = null;

export function schedulePush() {
  if (_pushTimer) return;
  const sinceError =
    _lastPushErrorAt === null ? Infinity : Date.now() - _lastPushErrorAt;
  const delay = Math.max(PUSH_DEBOUNCE_MS, PUSH_RETRY_MS - sinceError);
  _pushTimer = setTimeout(async () => {
    _pushTimer = null;
    // A sync already in flight took its snapshot before these rows were
    // queued (and may be busy pulling); let it finish, then push again.
    if (_syncPromise) await _syncPromise.catch(() => {});
    if (navigator.onLine) requestSync({ skipPull: true });
  }, delay);
}

/**
 * Start listening for online events. Call once at app boot.
 *
 * Phase 1 note: the 5-minute polling interval was intentionally removed.
 * Per-read SWR (services/cache.js) now keeps individual tables warm; full
 * re-pulls happen only on the `online` event or via explicit `requestSync()`.
 */
export function startSyncListener() {
  window.addEventListener("online", () => {
    // Phase 7: skip the automatic background pull on metered / data-saver
    // connections. Pending offline *mutations* are still pushed (requestSync
    // drains the queue first), but we avoid pulling all tables to conserve
    // bandwidth. Users can still trigger a manual refresh.
    if (isDataSaver()) {
      console.log(
        "[sync] Online (data-saver) — pushing pending mutations only",
      );
      requestSync({ skipPull: true });
      return;
    }
    console.log("[sync] Online — starting sync");
    requestSync();
  });

  // Native apps stay alive in the background, so pull changes made on other
  // devices whenever the app returns to the foreground (throttled).
  let lastResumeSync = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !navigator.onLine) return;
    const now = Date.now();
    if (now - lastResumeSync < 30_000) return;
    lastResumeSync = now;
    requestSync({ skipPull: isDataSaver() });
  });
}

// ── Tables we sync, with their soft-delete / activation flag conventions ──
//
// Each table has `updated_at`; we use it as the incremental watermark.
// `softDeleteField` lets us pull "removed" rows so we can hard-delete them
// from Dexie locally (since the local cache is the source of UI truth and
// must not show server-deleted rows).
const SYNC_TABLES = [
  {
    name: "transactions",
    select: "*, categories(id, name, color, type), accounts(id, name, type)",
    softDeleteField: "deleted_at", // not-null = removed
    activeFilter: null,
  },
  {
    name: "categories",
    select: "*",
    softDeleteField: null,
    activeFilter: "is_active",
  },
  {
    name: "accounts",
    select: "*",
    softDeleteField: null,
    activeFilter: "is_active",
  },
  {
    name: "budget_plans",
    select: "*",
    softDeleteField: null,
    activeFilter: null,
  },
  {
    name: "budget_items",
    select: "*, categories(id, name, color, type)",
    softDeleteField: null,
    activeFilter: null,
  },
  {
    name: "user_preferences",
    select: "*",
    softDeleteField: null,
    activeFilter: null,
  },
  {
    name: "recurring_templates",
    select:
      "*, categories(id, name, color, type), accounts!recurring_templates_account_id_fkey(id, name, type)",
    softDeleteField: null,
    activeFilter: "is_active",
  },
];

/**
 * Pull fresh data from Supabase into IndexedDB.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.full=false] — when true, ignore the watermark and
 *   re-pull everything (used after sign-in, after a reset, or by a "Force
 *   refresh" affordance).
 * @returns {Promise<void>}
 */
export async function pullAll({ full = false } = {}) {
  if (!navigator.onLine) return;

  try {
    const user = await getCurrentUser();
    if (!user) return;

    await Promise.all(
      SYNC_TABLES.map((t) => pullTableIncremental(t, { full })),
    );

    console.log("[sync] Pull complete");
  } catch (err) {
    console.error("[sync] Pull failed:", err);
  }
}

// ── Watermarks ──
//
// The watermark is the `updated_at` value up to which a table has been
// pulled; the next incremental pull asks for rows newer than it. It must
// never run ahead of rows the pull has not seen, so:
//
//  * it is taken from before the fetch (rows committed while a long fetch is
//    paging are picked up next time), never from the clock at the end;
//  * it is the smaller of that local time and the newest `updated_at` the
//    fetch returned, so a client clock that runs ahead cannot push it past
//    the data. This one rule serves every table: where the server stamps
//    `updated_at` by trigger (categories, budget_items, recurring_templates)
//    the newest value seen is server time; on the other tables it is some
//    client's clock, which is why it only ever lowers the watermark;
//  * a margin is subtracted, so rows that commit slightly late or carry a
//    slightly older timestamp are re-read instead of skipped. Re-read rows
//    that are already mirrored are dropped by `dropUnchangedRows`.
//
// A writer whose clock lags by more than the margin on a table without a
// server-side `updated_at` trigger can still be missed; only server
// timestamps on those tables close that gap.
const WATERMARK_MARGIN_MS = 5 * 60 * 1000;

/**
 * @param {number} fetchStartedAt — local `Date.now()` from before the fetch
 * @param {Array<{updated_at?: string}>} rows — the rows the fetch returned
 * @returns {string} ISO timestamp to store as the table's watermark
 */
export function computeWatermark(fetchStartedAt, rows) {
  let newest = null;
  for (const row of rows) {
    const at = row.updated_at ? Date.parse(row.updated_at) : NaN;
    if (!Number.isNaN(at) && (newest === null || at > newest)) newest = at;
  }
  const upTo = newest === null ? fetchStartedAt : Math.min(fetchStartedAt, newest);
  return new Date(upTo - WATERMARK_MARGIN_MS).toISOString();
}

/**
 * The `updated_at` to pull from. A stored watermark that lies in this
 * client's future (written while its clock ran ahead, or by an older
 * version) is pulled back so it cannot hide rows indefinitely.
 */
export function pullSince(lastSynced, now) {
  const stored = Date.parse(lastSynced);
  const ceiling = now - WATERMARK_MARGIN_MS;
  return Number.isNaN(stored) || stored > ceiling
    ? new Date(ceiling).toISOString()
    : lastSynced;
}

/**
 * Pull a single table incrementally. Falls back to a full pull when the
 * local cache is empty (cold) or `full` is set.
 */
async function pullTableIncremental(tableConfig, { full = false } = {}) {
  const { name, select, softDeleteField, activeFilter } = tableConfig;
  const lastSynced = full ? null : await getTableLastSynced(name);
  const localCount = await getTableRowCount(name);
  const isCold = localCount === 0;
  const fetchStartedAt = Date.now();

  // Cold cache or explicit full → do a clearing pull and write watermark.
  if (full || isCold || !lastSynced) {
    const rows = await fetchAll(name, select, {
      activeFilter,
      includeDeleted: false,
    });
    await cacheTable(name, rows, {
      lastSynced: computeWatermark(fetchStartedAt, rows),
    });
    notifyTable(name);
    return;
  }

  // Incremental: fetch rows changed since lastSynced.
  // We fetch BOTH active and inactive/deleted so we can prune locally.
  const changed = await fetchAll(name, select, {
    activeFilter: null,
    includeDeleted: true,
    updatedSince: pullSince(lastSynced, fetchStartedAt),
  });

  if (!changed.length) {
    // Nothing changed — no watermark bump needed (it stays at the previous
    // server timestamp; no risk of missing an update).
    return;
  }

  // Split into upserts vs deletes.
  const removedIds = [];
  const upserts = [];
  for (const row of changed) {
    const isRemoved =
      (softDeleteField && row[softDeleteField] != null) ||
      (activeFilter && row[activeFilter] === false);
    if (isRemoved) removedIds.push(row.id);
    else upserts.push(row);
  }

  // The margin makes each pull re-read the newest rows; only what actually
  // differs from the mirror is written and announced.
  const { rows: newRows, removedIds: newRemovedIds } = await dropUnchangedRows(
    name,
    upserts,
    removedIds,
  );

  await cacheTableIncremental(name, newRows, {
    removedIds: newRemovedIds,
    lastSynced: computeWatermark(fetchStartedAt, changed),
  });
  if (newRows.length || newRemovedIds.length) notifyTable(name);
}

// ── Internals ──

async function _doSync({ skipPull = false } = {}) {
  if (_syncing) return;
  if (!navigator.onLine) return;

  _syncing = true;
  _lastError = null;
  _syncProgress = { done: 0, total: 0 };
  notify();

  try {
    const pending = await drainAll();
    const allOps = Object.entries(pending);

    // Count total ops
    let total = 0;
    for (const [, rows] of allOps) total += rows.length;
    _syncProgress.total = total;
    notify();

    if (total === 0) {
      // Even with no pushes, run an incremental pull so this tab catches
      // up on remote changes (e.g., another device).
      // Phase 7: honour skipPull on metered connections.
      if (!skipPull) await pullAll();
      _syncing = false;
      notify();
      return;
    }

    console.log(`[sync] Pushing ${total} offline changes…`);

    // A row changed again while its push was in flight keeps its offline
    // flags (see markSynced). Push those rows again so the newer change is
    // not left waiting for the next sync trigger; bounded so a row that is
    // being edited continuously cannot keep the sync running.
    // Local budget plan id → the server plan it turned out to be, for items
    // in this run's snapshot that still carry the local id.
    const planIds = new Map();
    let ops = allOps;
    let pushed = 0;
    let failed = 0;
    let leftChanged = false;
    for (let pass = 0; pass < 3 && ops.length; pass++) {
      const changedDuringPush = new Set();
      for (const [tableName, rows] of ops) {
        for (const row of rows) {
          try {
            const serverRow = await pushRow(tableName, row, planIds);
            let cleared;
            if (serverRow && serverRow.id !== row.id) {
              // The server already held this record under another id.
              if (tableName === "budget_plans") planIds.set(row.id, serverRow.id);
              cleared = await adoptServerRow(tableName, row, serverRow);
            } else {
              cleared = await markSynced(tableName, row.id, row._offlineAt);
            }
            pushed++;
            if (!cleared) changedDuringPush.add(`${tableName}/${row.id}`);
          } catch (err) {
            console.error(`[sync] Failed to sync ${tableName}/${row.id}:`, err);
            _lastError = err.message || String(err);
            _lastPushErrorAt = Date.now();
            failed++;
            // Continue with other rows — don't let one failure block everything
          }
          _syncProgress.done++;
          notify();
        }
      }

      leftChanged = changedDuringPush.size > 0;
      if (!leftChanged) break;
      ops = Object.entries(await drainAll())
        .map(([tableName, rows]) => [
          tableName,
          rows.filter((row) => changedDuringPush.has(`${tableName}/${row.id}`)),
        ])
        .filter(([, rows]) => rows.length);
      for (const [, rows] of ops) _syncProgress.total += rows.length;
    }

    // Rows are still queued. Push again later while runs keep making
    // progress: a row that failed may succeed once the rows it depended on
    // are through, or once a transient error has passed. `schedulePush`
    // applies the back-off after a failure. A run in which nothing got
    // through stops here and waits for the next trigger (reconnect, tab
    // focus, another write) instead of retrying on a timer.
    if (leftChanged || (failed > 0 && pushed > 0)) schedulePush();

    // After pushing, pull fresh data to reconcile server-side changes.
    // Phase 7: skip the pull on metered connections when the caller asked.
    if (!skipPull) await pullAll();

    console.log("[sync] Push complete");
  } catch (err) {
    console.error("[sync] Sync failed:", err);
    _lastError = err.message || String(err);
    _lastPushErrorAt = Date.now();
  } finally {
    _syncing = false;
    notify();
  }
}

// Tables whose rows carry a NOT NULL `user_id` column. `budget_items` is
// scoped through its parent `budget_plans` row and has no such column.
const USER_SCOPED_TABLES = new Set([
  "transactions",
  "categories",
  "accounts",
  "budget_plans",
  "user_preferences",
  "recurring_templates",
]);

/**
 * Build the payload sent to the backend for one pending offline row.
 *
 * Offline-created rows are stored with `user_id: null` because the offline
 * wrappers have no user at hand. `user_id` is NOT NULL on the server, so a
 * create must carry the current user's id, and an update must never send a
 * null `user_id` (that would try to null the column).
 *
 * Pure so it can be unit-tested without a backend.
 *
 * @param {string} tableName
 * @param {Object} row — the Dexie row, including offline metadata
 * @param {string|null} userId — the signed-in user's id
 * @returns {Object} the cleaned row
 */
export function buildPushPayload(tableName, row, userId) {
  // Strip offline metadata before sending to Supabase
  const clean = { ...row };
  delete clean._offline;
  delete clean._action;
  delete clean._offlineAt;
  // Strip any joined objects that came from caching
  delete clean.categories;
  delete clean.accounts;
  delete clean.to_accounts;
  delete clean._archiveRestore;
  if (tableName === "categories" && row._action === "update" && !row._archiveRestore) {
    delete clean.is_archived;
  }

  if (USER_SCOPED_TABLES.has(tableName)) {
    if (row._action === "create" && clean.user_id == null) {
      if (!userId) {
        throw new Error(
          `Cannot sync ${tableName}/${row.id}: no signed-in user`,
        );
      }
      clean.user_id = userId;
    } else if (row._action === "update" && clean.user_id == null) {
      delete clean.user_id;
    }
  }

  return clean;
}

// Server-side natural keys (see NATURAL_KEYS in offlineDb.js): the conflict
// target for pushing a row whose record may already exist under another id.
const NATURAL_KEY_CONFLICT = {
  user_preferences: "user_id,preference_key",
  budget_plans: "user_id,month,year",
  budget_items: "budget_plan_id,category_id",
};

// Upsert on the natural key. The payload carries neither `id` nor
// `created_at`, so an existing server row keeps its primary key and creation
// time. Returns the server row.
async function upsertOnNaturalKey(tableName, clean) {
  const payload = { ...clean };
  delete payload.id;
  delete payload.created_at;
  const { data, error } = await supabase
    .from(tableName)
    .upsert(payload, { onConflict: NATURAL_KEY_CONFLICT[tableName] })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Push a single offline record to Supabase.
 *
 * @returns {Promise<Object|undefined>} the server row, when the push went
 *   through a natural key and the server's id may differ from the local one
 */
async function pushRow(tableName, row, planIds = new Map()) {
  const action = row._action;
  // A locally cached preference row may have a placeholder id and no
  // user_id, so preferences are always matched on their natural key.
  const byNaturalKey =
    tableName === "user_preferences" &&
    (action === "create" || action === "update");
  const needsUser =
    row.user_id == null &&
    USER_SCOPED_TABLES.has(tableName) &&
    (action === "create" || byNaturalKey);
  const user = needsUser ? await getCurrentUser() : null;
  const clean = buildPushPayload(tableName, row, user?.id ?? null);

  if (tableName === "budget_items" && planIds.has(clean.budget_plan_id)) {
    clean.budget_plan_id = planIds.get(clean.budget_plan_id);
  }

  if (byNaturalKey) {
    if (clean.user_id == null) {
      if (!user?.id) {
        throw new Error(`Cannot sync ${tableName}/${row.id}: no signed-in user`);
      }
      clean.user_id = user.id;
    }
    return upsertOnNaturalKey(tableName, clean);
  }

  if (action === "create") {
    const { error } = await supabase
      .from(tableName)
      .upsert(clean, { onConflict: "id" });
    // 23505 here is a unique violation on something other than `id`: the
    // server already holds this record under a different id.
    if (error?.code === "23505" && NATURAL_KEY_CONFLICT[tableName]) {
      return upsertOnNaturalKey(tableName, clean);
    }
    if (error) throw error;
  } else if (action === "update") {
    const { id, ...updates } = clean;
    const { error } = await supabase
      .from(tableName)
      .update(updates)
      .eq("id", id);
    if (error) throw error;
  } else if (action === "delete") {
    if (tableName === "transactions") {
      // Soft-delete via RPC (mirrors service behavior)
      const { error } = await supabase.rpc("soft_delete_transaction", {
        txn_id: clean.id,
      });
      if (error) throw error;
    } else if (tableName === "categories" || tableName === "accounts") {
      // Soft-deactivate
      const { error } = await supabase
        .from(tableName)
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", clean.id);
      if (error) throw error;
    } else {
      // Hard delete for other tables
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq("id", clean.id);
      if (error) throw error;
    }
  }
}

/**
 * Paginated fetch of rows from a Supabase table for the current user.
 *
 * @param {string} tableName
 * @param {string} select
 * @param {Object} [opts]
 * @param {string|null} [opts.activeFilter] — column name to require `=true`
 *   (used for `categories`/`accounts`/`recurring_templates` on full pulls).
 * @param {boolean} [opts.includeDeleted=false] — when false, filters
 *   `deleted_at IS NULL` for tables that have it.
 * @param {string|null} [opts.updatedSince] — when set, filters
 *   `updated_at > opts.updatedSince` for incremental pulls.
 */
async function fetchAll(
  tableName,
  select = "*",
  { activeFilter = null, includeDeleted = false, updatedSince = null } = {},
) {
  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from(tableName)
      .select(select)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (!includeDeleted && tableName === "transactions") {
      query = query.is("deleted_at", null);
    }
    if (activeFilter) {
      query = query.eq(activeFilter, true);
    }
    if (updatedSince) {
      query = query.gt("updated_at", updatedSince);
    }

    const { data, error } = await query;
    if (error) throw error;
    allData = allData.concat(data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allData;
}
