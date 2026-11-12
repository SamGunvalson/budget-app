// Unit tests for the offline mirror and sync push path (OFF-1, OFF-2, OFF-6,
// OFF-15). Dexie is replaced with a small in-memory fake, so these cover the
// module logic only — not real IndexedDB transaction or index behaviour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, mock, test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { SourceTextModule, SyntheticModule } from "node:vm";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const sources = {
  offlineDb: read("../src/services/offlineDb.js"),
  syncQueue: read("../src/utils/syncQueue.js"),
  sync: read("../src/services/sync.js"),
  offlineAware: read("../src/services/offlineAware.js"),
  transactions: read("../src/services/transactions.js"),
  accounts: read("../src/services/accounts.js"),
  categories: read("../src/services/categories.js"),
  budgets: read("../src/services/budgets.js"),
  cache: read("../src/services/cache.js"),
  ids: read("../src/utils/ids.js"),
};

const setOnline = (onLine) =>
  Object.defineProperty(globalThis, "navigator", {
    value: { onLine },
    configurable: true,
    writable: true,
  });

// setTimeout is mocked in every test: the sync engine schedules follow-up
// pushes on timers (1.5 s debounce, 30 s back-off) that would otherwise fire
// in real time after a test has finished. Tests advance time with
// `mock.timers.tick`; `settle` uses real I/O turns.
beforeEach(() => {
  setOnline(false);
  mock.timers.enable({ apis: ["setTimeout"] });
});
afterEach(() => mock.timers.reset());

// ── In-memory Dexie stand-in ──

const clone = (value) => structuredClone(value);

class FakeCollection {
  constructor(table, predicate) {
    this.table = table;
    this.predicate = predicate;
  }
  filter(fn) {
    return new FakeCollection(this.table, (r) => this.predicate(r) && fn(r));
  }
  async toArray() {
    return [...this.table.rows.values()].filter(this.predicate).map(clone);
  }
  async primaryKeys() {
    return (await this.toArray()).map((r) => r[this.table.keyPath]);
  }
  async count() {
    return (await this.toArray()).length;
  }
  async first() {
    return (await this.toArray())[0];
  }
}

class FakeTable {
  constructor(keyPath) {
    this.keyPath = keyPath;
    this.rows = new Map();
    this.failBulkPut = false;
  }
  async get(id) {
    const row = this.rows.get(id);
    return row ? clone(row) : undefined;
  }
  async put(row) {
    this.rows.set(row[this.keyPath], clone(row));
  }
  async bulkGet(ids) {
    return Promise.all(ids.map((id) => this.get(id)));
  }
  async bulkPut(rows) {
    if (this.failBulkPut) throw new Error("bulkPut failed");
    for (const row of rows) await this.put(row);
  }
  async delete(id) {
    this.rows.delete(id);
  }
  async bulkDelete(ids) {
    for (const id of ids) this.rows.delete(id);
  }
  async update(id, changes) {
    const row = this.rows.get(id);
    if (!row) return 0;
    this.rows.set(id, { ...row, ...clone(changes) });
    return 1;
  }
  async clear() {
    this.rows.clear();
  }
  async count() {
    return this.rows.size;
  }
  async toArray() {
    return [...this.rows.values()].map(clone);
  }
  where(field) {
    // "[a+b]" is a compound index, matched against an array of values.
    const fields = field.startsWith("[") ? field.slice(1, -1).split("+") : null;
    const matches = (row, value) =>
      fields ? fields.every((f, i) => row[f] === value[i]) : row[field] === value;
    return {
      equals: (value) => new FakeCollection(this, (r) => matches(r, value)),
    };
  }
}

class FakeDexie {
  constructor() {
    this.tables = {};
    this.transactions = [];
  }
  version() {
    return {
      stores: (schema) => {
        for (const [name, spec] of Object.entries(schema)) {
          const table = new FakeTable(spec.split(",")[0].trim());
          this.tables[name] = table;
          // The real schema has a `transactions` store; keep the recorder
          // reachable under another name when that property is taken.
          if (name === "transactions") this.transactionLog = this.transactions;
          this[name] = table;
        }
      },
    };
  }
  table(name) {
    assert.ok(this.tables[name], `Unknown table ${name}`);
    return this.tables[name];
  }
  // All-or-nothing over the listed tables, like a Dexie rw transaction.
  async transaction(mode, ...args) {
    const fn = args.pop();
    const snapshots = args.map((t) => [t, new Map(t.rows)]);
    this.transactionLog.push({ mode, tables: args });
    try {
      return await fn();
    } catch (err) {
      for (const [t, rows] of snapshots) t.rows = rows;
      throw err;
    }
  }
}

// ── Module loading ──

const unexpected = (specifier, name) => () => {
  throw new Error(`Unexpected call to ${name} from ${specifier}`);
};

// Collect the names a source file imports from each specifier so anything a
// test does not supply can be stubbed with a function that fails if called.
function importedNames(source) {
  const bySpecifier = {};
  const pattern = /import\s+([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;
  for (const [, defaultName, named, specifier] of source.matchAll(pattern)) {
    const names = (bySpecifier[specifier] ||= new Set());
    if (defaultName) names.add("default");
    for (const part of (named || "").split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0];
      if (name) names.add(name);
    }
  }
  return bySpecifier;
}

async function load(source, dependencies) {
  const imports = importedNames(source);
  const module = new SourceTextModule(source);
  await module.link((specifier) => {
    const provided = dependencies[specifier] || {};
    const names = new Set([...(imports[specifier] || []), ...Object.keys(provided)]);
    return new SyntheticModule([...names], function () {
      for (const name of names) {
        this.setExport(name, name in provided ? provided[name] : unexpected(specifier, name));
      }
    });
  });
  await module.evaluate();
  return module.namespace;
}

async function loadOfflineDb() {
  const notified = [];
  const offlineDb = await load(sources.offlineDb, {
    dexie: { default: FakeDexie },
    "../utils/ids": { ...(await load(sources.ids, {})) },
    "./cache": { notifyTable: (name) => notified.push(name) },
  });
  return { offlineDb, db: offlineDb.db, notified };
}

// `services` supplies backend stubs keyed by module ("./transactions",
// "./accounts", …); anything not supplied fails the test if it is called.
// `flush` stands in for the sync engine's push when a write finds a pending
// row. Pass `base` (from loadLocalStore) and `sync` (a real sync.js namespace)
// to run the wrappers against the real sync engine instead of the stub.
async function loadLocalStore() {
  const { offlineDb, db, notified } = await loadOfflineDb();
  const syncQueue = await load(sources.syncQueue, {
    "../services/offlineDb": { ...offlineDb },
  });
  return { offlineDb, db, syncQueue, notified };
}

// `realCache: true` runs reads through the real cache.js (SWR) instead of a
// stub that fails when a read is attempted.
async function loadOfflineAware({ services = {}, flush = async () => {}, base, sync, realCache = false } = {}) {
  const { offlineDb, db, syncQueue } = base || (await loadLocalStore());
  const flushes = [];
  const scheduled = [];
  const cache = realCache
    ? { ...(await load(sources.cache, {})) }
    : { notifyTable: () => {}, swrRead: unexpected("./cache", "swrRead") };
  const offlineAware = await load(sources.offlineAware, {
    "./offlineDb": { ...offlineDb },
    "../utils/syncQueue": { ...syncQueue },
    "../utils/ids": { newId: offlineDb.newId },
    "./cache": cache,
    "./sync": sync
      ? { ...sync }
      : {
          requestSync: async (opts) => {
            flushes.push(opts);
            await flush({ db, offlineDb });
          },
          schedulePush: () => scheduled.push(true),
        },
    "../utils/categoryArchive": {
      isAvailableCategory: (c) => c.is_active !== false && c.is_archived !== true,
    },
    ...services,
  });
  return { offlineAware, offlineDb, db, flushes, scheduled, cache };
}

// Let pending promise callbacks and I/O turns run (real time, not mocked).
async function settle(until = () => false) {
  for (let i = 0; i < 50 && !until(); i++) await nextTurn();
}

// By default the queue and markSynced are stubs fed from `pending`. Pass
// `modules` (real offlineDb / syncQueue namespaces) to run against the fake
// Dexie instead; `onCall` runs before each backend call resolves.
// `respond(call)` may return the backend's `{ data, error }` for a call.
async function loadSync({ pending = {}, user = { id: "user-1" }, modules = {}, onCall, respond } = {}) {
  const calls = [];
  const synced = [];
  const result = {
    then(resolve, reject) {
      const call = calls.at(-1);
      return Promise.resolve(onCall?.(call))
        .then(() => respond?.(call) ?? { error: null })
        .then(resolve, reject);
    },
    select: () => result,
    single: () => result,
  };
  const supabase = {
    from(table) {
      return {
        upsert: (payload, options) => {
          calls.push({ table, method: "upsert", payload, options });
          return result;
        },
        update: (payload) => ({
          eq: (column, value) => {
            calls.push({ table, method: "update", payload, column, value });
            return result;
          },
        }),
      };
    },
    rpc: (name, args) => {
      calls.push({ method: "rpc", name, args });
      return result;
    },
  };
  const sync = await load(sources.sync, {
    "./supabase": { supabase, getCurrentUser: async () => user },
    "./offlineDb": modules.offlineDb || {
      markSynced: async (table, id) => {
        synced.push(`${table}/${id}`);
        return true;
      },
    },
    "../utils/syncQueue": modules.syncQueue || { drainAll: async () => pending },
    "./cache": { notifyTable: () => {} },
    "../hooks/useDataSaver": { isDataSaver: () => false },
  });
  return { sync, calls, synced };
}

// ── OFF-1: user_id on pushed rows ──

test("OFF-1: buildPushPayload fills user_id on offline creates", async () => {
  const { sync } = await loadSync();
  const row = {
    id: "t1",
    user_id: null,
    amount: 1250,
    categories: { id: "c1" },
    accounts: { id: "a1" },
    _offline: 1,
    _action: "create",
    _offlineAt: "2026-01-01T00:00:00.000Z",
  };
  assert.deepEqual(sync.buildPushPayload("transactions", row, "user-1"), {
    id: "t1",
    user_id: "user-1",
    amount: 1250,
  });
  // The stored row is not mutated.
  assert.equal(row.user_id, null);
});

test("OFF-1: buildPushPayload refuses a create with no signed-in user", async () => {
  const { sync } = await loadSync();
  assert.throws(
    () => sync.buildPushPayload("accounts", { id: "a1", user_id: null, _action: "create" }, null),
    /no signed-in user/,
  );
});

test("OFF-1: buildPushPayload never sends a null user_id on updates", async () => {
  const { sync } = await loadSync();
  const nulled = sync.buildPushPayload(
    "categories",
    { id: "c1", user_id: null, name: "Food", _action: "update" },
    "user-1",
  );
  assert.equal("user_id" in nulled, false);

  const kept = sync.buildPushPayload(
    "categories",
    { id: "c1", user_id: "owner", name: "Food", _action: "update" },
    "user-1",
  );
  assert.equal(kept.user_id, "owner");
});

test("OFF-1: buildPushPayload leaves budget_items without a user_id", async () => {
  const { sync } = await loadSync();
  const payload = sync.buildPushPayload(
    "budget_items",
    { id: "b1", budget_plan_id: "p1", planned_amount: 5000, _action: "create" },
    "user-1",
  );
  assert.equal("user_id" in payload, false);
});

test("OFF-1: sync pushes offline creates and updates with a valid user_id", async () => {
  setOnline(true);
  const { sync, calls, synced } = await loadSync({
    pending: {
      accounts: [{ id: "a1", user_id: null, name: "Cash", _offline: 1, _action: "create" }],
      transactions: [
        { id: "t1", user_id: null, amount: 1250, _offline: 1, _action: "create" },
        { id: "t2", user_id: null, amount: 900, _offline: 1, _action: "update" },
      ],
    },
  });
  await sync.requestSync({ skipPull: true });

  assert.deepEqual(calls, [
    {
      table: "accounts",
      method: "upsert",
      payload: { id: "a1", user_id: "user-1", name: "Cash" },
      options: { onConflict: "id" },
    },
    {
      table: "transactions",
      method: "upsert",
      payload: { id: "t1", user_id: "user-1", amount: 1250 },
      options: { onConflict: "id" },
    },
    { table: "transactions", method: "update", payload: { amount: 900 }, column: "id", value: "t2" },
  ]);
  assert.deepEqual(synced, ["accounts/a1", "transactions/t1", "transactions/t2"]);
  assert.equal(sync.getSyncState().error, null);
});

test("OFF-1: a create with no signed-in user stays pending instead of being pushed", async () => {
  setOnline(true);
  const { sync, calls, synced } = await loadSync({
    user: null,
    pending: {
      transactions: [{ id: "t1", user_id: null, amount: 1250, _offline: 1, _action: "create" }],
    },
  });
  await sync.requestSync({ skipPull: true });

  assert.deepEqual(calls, []);
  assert.deepEqual(synced, []);
  assert.match(sync.getSyncState().error, /no signed-in user/);
});

// ── OFF-6: full pull keeps pending rows ──

test("OFF-6: cacheTable keeps pending offline rows and replaces the rest", async () => {
  const { offlineDb, db } = await loadOfflineDb();
  await db.transactions.bulkPut([
    { id: "stale", amount: 100 },
    { id: "synced", amount: 200 },
  ]);
  await offlineDb.putOffline("transactions", { id: "edited", amount: 999 }, "update");
  await offlineDb.putOffline("transactions", { id: "new-local", amount: 500 }, "create");

  await offlineDb.cacheTable("transactions", [
    { id: "synced", amount: 250 },
    { id: "edited", amount: 300 },
    { id: "server-only", amount: 400 },
  ]);

  const rows = Object.fromEntries((await db.transactions.toArray()).map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(rows).sort(), ["edited", "new-local", "server-only", "synced"]);
  assert.equal(rows.synced.amount, 250);
  assert.equal(rows["server-only"].amount, 400);
  // The pending local row wins over the server copy with the same id.
  assert.equal(rows.edited.amount, 999);
  assert.equal(rows.edited._offline, 1);
  assert.equal(rows.edited._action, "update");
  assert.equal(rows["new-local"]._action, "create");

  assert.equal(await offlineDb.getPendingSyncCount(), 2);
  assert.ok(await offlineDb.getTableLastSynced("transactions"));
  assert.deepEqual(db.transactionLog, [
    { mode: "rw", tables: [db.transactions, db.sync_meta] },
  ]);
});

test("OFF-6: cacheTable leaves the table intact when the write fails", async () => {
  const { offlineDb, db } = await loadOfflineDb();
  await db.categories.bulkPut([{ id: "c1", name: "Food" }]);
  db.categories.failBulkPut = true;

  await assert.rejects(offlineDb.cacheTable("categories", [{ id: "c2", name: "Rent" }]));

  assert.deepEqual(await db.categories.toArray(), [{ id: "c1", name: "Food" }]);
  assert.equal(await offlineDb.getTableLastSynced("categories"), null);
});

test("OFF-6: cacheTable with no rows still clears a table that has nothing pending", async () => {
  const { offlineDb, db } = await loadOfflineDb();
  await db.accounts.bulkPut([{ id: "a1", name: "Cash" }]);
  await offlineDb.cacheTable("accounts", []);
  assert.equal(await db.accounts.count(), 0);
});

// ── OFF-15: pending counter reset ──

test("OFF-15: clearAllOfflineData resets the pending counter", async () => {
  const { offlineDb, db } = await loadOfflineDb();
  await offlineDb.putOffline("transactions", { id: "t1", amount: 100 }, "create");
  await offlineDb.putOffline("accounts", { id: "a1", name: "Cash" }, "create");
  assert.equal(await offlineDb.getPendingSyncCount(), 2);

  await offlineDb.clearAllOfflineData();
  assert.equal(await db.transactions.count(), 0);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);

  // The counter keeps tracking after the reset.
  await offlineDb.putOffline("transactions", { id: "t2", amount: 100 }, "create");
  assert.equal(await offlineDb.getPendingSyncCount(), 1);
});

// ── OFF-2: transfer deletes cover both legs ──

const transferRows = () => [
  { id: "out", transfer_group_id: "g1", amount: 5000, is_income: false, deleted_at: null },
  { id: "in", transfer_group_id: "g1", amount: 5000, is_income: true, deleted_at: null },
  { id: "gone", transfer_group_id: "g1", amount: 5000, deleted_at: "2026-01-01T00:00:00.000Z" },
  { id: "other-group", transfer_group_id: "g2", amount: 700, deleted_at: null },
  { id: "plain", transfer_group_id: null, amount: 300, deleted_at: null },
];

test("OFF-2: deleting a transfer offline soft-deletes and queues both legs", async () => {
  const { offlineAware, offlineDb, db } = await loadOfflineAware();
  await db.transactions.bulkPut(transferRows());

  const ids = await offlineAware.deleteTransactionOffline("out");
  assert.deepEqual(ids, ["out", "in"]);

  for (const id of ["out", "in"]) {
    const row = await db.transactions.get(id);
    assert.ok(row.deleted_at, `${id} should be soft-deleted`);
    assert.equal(row._offline, 1);
    assert.equal(row._action, "delete");
  }
  // Already-deleted legs, other groups and plain rows are left alone.
  assert.equal((await db.transactions.get("gone")).deleted_at, "2026-01-01T00:00:00.000Z");
  for (const id of ["gone", "other-group", "plain"]) {
    assert.equal((await db.transactions.get(id))._offline, undefined);
  }
  assert.equal((await db.transactions.get("other-group")).deleted_at, null);
  assert.equal(await offlineDb.getPendingSyncCount(), 2);
});

test("OFF-2: deleting a plain transaction offline queues only that row", async () => {
  const { offlineAware, offlineDb, db } = await loadOfflineAware();
  await db.transactions.bulkPut(transferRows());

  assert.deepEqual(await offlineAware.deleteTransactionOffline("plain"), ["plain"]);
  assert.equal((await db.transactions.get("plain"))._action, "delete");
  assert.equal(await offlineDb.getPendingSyncCount(), 1);

  // A row missing from the local cache is still reported, as before.
  assert.deepEqual(await offlineAware.deleteTransactionOffline("missing"), ["missing"]);
  assert.equal(await offlineDb.getPendingSyncCount(), 1);
});

test("OFF-2: an online delete marks every id the service returns", async () => {
  setOnline(true);
  const requested = [];
  const { offlineAware, offlineDb, db } = await loadOfflineAware({
    services: {
      "./transactions": {
        deleteTransaction: async (id) => {
          requested.push(id);
          return ["out", "in"];
        },
      },
    },
  });
  await db.transactions.bulkPut(transferRows());

  assert.deepEqual(await offlineAware.deleteTransactionOffline("out"), ["out", "in"]);
  assert.deepEqual(requested, ["out"]);
  for (const id of ["out", "in"]) {
    const row = await db.transactions.get(id);
    assert.ok(row.deleted_at, `${id} should be soft-deleted`);
    assert.equal(row._offline, undefined);
  }
  assert.equal((await db.transactions.get("other-group")).deleted_at, null);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
});

// ── OFF-3: online writes must not overwrite a pending row ──

const failIfCalled = (name) => async () => {
  throw new Error(`${name} should not reach the backend`);
};

// A flush that pushes everything successfully, like a working sync engine.
const flushAll = async ({ db, offlineDb }) => {
  for (const name of ["transactions", "accounts"]) {
    for (const row of await offlineDb.getPendingRecords(name)) {
      await offlineDb.markSynced(name, row.id, row._offlineAt);
    }
  }
  return db;
};

test("OFF-3: an online update of a pending row is merged into the queue, not sent over it", async () => {
  const { offlineAware, offlineDb, db, flushes } = await loadOfflineAware({
    services: { "./transactions": { updateTransaction: failIfCalled("updateTransaction") } },
  });
  await db.transactions.put({ id: "t1", amount: 100, description: "old", payee: "old" });

  await offlineAware.updateTransactionOffline("t1", { description: "edited offline" });
  setOnline(true); // reconnected, but the queued change has not been pushed
  const updated = await offlineAware.updateTransactionOffline("t1", { payee: "edited online" });

  assert.equal(updated.description, "edited offline");
  assert.equal(updated.payee, "edited online");
  const row = await db.transactions.get("t1");
  assert.equal(row.description, "edited offline");
  assert.equal(row.payee, "edited online");
  assert.equal(row._offline, 1);
  assert.equal(row._action, "update");
  assert.equal(await offlineDb.getPendingSyncCount(), 1);
  // It tried to flush the queue first, without a pull.
  assert.deepEqual(flushes, [{ skipPull: true }]);
});

test("OFF-3: once the flush clears the pending row the write goes to the backend", async () => {
  const sent = [];
  const { offlineAware, offlineDb, db } = await loadOfflineAware({
    flush: flushAll,
    services: {
      "./transactions": {
        updateTransaction: async (id, updates) => {
          sent.push({ id, updates });
          return { id, amount: 100, description: "edited offline", ...updates };
        },
      },
    },
  });
  await db.transactions.put({ id: "t1", amount: 100, description: "old", payee: "old" });
  await offlineAware.updateTransactionOffline("t1", { description: "edited offline" });

  setOnline(true);
  await offlineAware.updateTransactionOffline("t1", { payee: "edited online" });

  assert.deepEqual(sent, [{ id: "t1", updates: { payee: "edited online" } }]);
  const row = await db.transactions.get("t1");
  assert.equal(row.payee, "edited online");
  assert.equal(row.description, "edited offline");
  assert.equal(row._offline, undefined);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
});

test("OFF-3: an online update of an unsynced create stays a queued create", async () => {
  const { offlineAware, offlineDb, db } = await loadOfflineAware({
    services: {
      "./transactions": { updateTransaction: failIfCalled("updateTransaction") },
      "./accounts": { updateAccount: failIfCalled("updateAccount") },
    },
  });
  const created = await offlineAware.createTransactionOffline({
    account_id: "a1",
    category_id: "c1",
    amount: 1250,
    description: "Lunch",
    transaction_date: "2026-03-01",
    is_income: false,
  });
  const account = await offlineAware.createAccountOffline({ name: "Cash", type: "checking" });

  setOnline(true);
  await offlineAware.updateTransactionOffline(created.id, { amount: 1500 });
  await offlineAware.updateAccountOffline(account.id, { name: "Wallet" });

  const tx = await db.transactions.get(created.id);
  assert.equal(tx.amount, 1500);
  assert.equal(tx.description, "Lunch");
  assert.equal(tx._action, "create");
  const acct = await db.accounts.get(account.id);
  assert.equal(acct.name, "Wallet");
  assert.equal(acct._action, "create");
  assert.equal(await offlineDb.getPendingSyncCount(), 2);
});

test("OFF-3: a row with nothing pending goes straight to the backend without a flush", async () => {
  setOnline(true);
  const { offlineAware, db, flushes } = await loadOfflineAware({
    services: {
      "./transactions": {
        updateTransaction: async (id, updates) => ({ id, amount: 100, ...updates }),
      },
    },
  });
  await db.transactions.put({ id: "t1", amount: 100, payee: "old" });

  await offlineAware.updateTransactionOffline("t1", { payee: "new" });

  assert.deepEqual(flushes, []);
  assert.deepEqual(await db.transactions.get("t1"), { id: "t1", amount: 100, payee: "new" });
});

test("OFF-3: offline writes to a pending row do not attempt a flush", async () => {
  const { offlineAware, db, flushes } = await loadOfflineAware();
  await db.transactions.put({ id: "t1", amount: 100 });
  await offlineAware.updateTransactionOffline("t1", { amount: 200 });
  await offlineAware.updateTransactionOffline("t1", { amount: 300 });

  assert.deepEqual(flushes, []);
  assert.equal((await db.transactions.get("t1")).amount, 300);
});

// ── APP-1: the remaining transaction actions go through offline wrappers ──

const seedLookups = async (db) => {
  await db.categories.bulkPut([
    { id: "c-food", name: "Food", color: "#111", type: "needs", is_active: true },
    { id: "c-rent", name: "Rent", color: "#222", type: "needs", is_active: true },
    { id: "c-xfer", name: "Account Transfer", color: "#333", type: "transfer", is_active: true },
  ]);
  await db.accounts.bulkPut([
    { id: "a-check", name: "Checking", type: "checking" },
    { id: "a-save", name: "Savings", type: "savings" },
    { id: "a-card", name: "Card", type: "credit" },
  ]);
};

const pendingActions = async (db) =>
  Object.fromEntries(
    (await db.transactions.toArray())
      .filter((r) => r._offline === 1)
      .map((r) => [r.id, r._action]),
  );

test("APP-1: transfers, linked transfers and adjustments can be created offline", async () => {
  const { offlineAware, offlineDb, db } = await loadOfflineAware();
  await seedLookups(db);

  const [out, inc] = await offlineAware.createTransferOffline({
    from_account_id: "a-check",
    to_account_id: "a-save",
    amount: 5000,
    description: " Move ",
    transaction_date: "2026-03-01",
    category_id: "c-xfer",
  });
  assert.equal(out.is_income, false);
  assert.equal(inc.is_income, true);
  assert.equal(out.amount, 5000);
  assert.equal(inc.amount, 5000);
  assert.equal(out.description, "Move");
  assert.equal(out.account_id, "a-check");
  assert.equal(inc.account_id, "a-save");
  assert.ok(out.transfer_group_id);
  assert.equal(out.transfer_group_id, inc.transfer_group_id);
  assert.notEqual(out.id, inc.id);
  assert.equal(out.status, "posted");
  assert.deepEqual(inc.accounts, { id: "a-save", name: "Savings", type: "savings" });
  assert.equal(out.categories.type, "transfer");

  const [main, companion] = await offlineAware.createLinkedTransferOffline({
    account_id: "a-check",
    linked_account_id: "a-card",
    category_id: "c-food",
    amount: 2000,
    companion_amount: 1800,
    description: "Card payment",
    transaction_date: "2026-03-02",
    is_income: false,
  });
  assert.equal(main.category_id, "c-food");
  assert.equal(main.amount, 2000);
  assert.equal(main.is_income, false);
  assert.equal(companion.category_id, "c-xfer");
  assert.equal(companion.amount, 1800);
  assert.equal(companion.is_income, true);
  assert.equal(companion.account_id, "a-card");
  assert.equal(main.transfer_group_id, companion.transfer_group_id);

  const adjustment = await offlineAware.createAdjustmentOffline({
    account_id: "a-save",
    category_id: "c-xfer",
    amount: 700,
    description: "Reconcile",
    transaction_date: "2026-03-03",
    is_income: true,
  });
  assert.equal(adjustment.transfer_group_id, null);
  assert.equal(adjustment.amount, 700);

  const actions = await pendingActions(db);
  assert.deepEqual(
    Object.keys(actions).sort(),
    [out.id, inc.id, main.id, companion.id, adjustment.id].sort(),
  );
  assert.ok(Object.values(actions).every((a) => a === "create"));
  assert.equal(await offlineDb.getPendingSyncCount(), 5);
});

test("APP-1: a linked transfer needs an available Account Transfer category offline", async () => {
  const { offlineAware, db } = await loadOfflineAware();
  await db.categories.put({ id: "c-food", name: "Food", type: "needs", is_active: true });
  await assert.rejects(
    offlineAware.createLinkedTransferOffline({
      account_id: "a-check",
      linked_account_id: "a-card",
      category_id: "c-food",
      amount: 2000,
      description: "Card payment",
      transaction_date: "2026-03-02",
      is_income: false,
    }),
    /Account Transfer/,
  );
  assert.equal(await db.transactions.count(), 0);
});

test("APP-1: transfer and linked-transfer edits update both legs offline", async () => {
  const { offlineAware, db } = await loadOfflineAware();
  await seedLookups(db);
  await db.transactions.bulkPut([
    { id: "out", transfer_group_id: "g1", account_id: "a-check", category_id: "c-xfer", amount: 5000, is_income: false, deleted_at: null },
    { id: "in", transfer_group_id: "g1", account_id: "a-save", category_id: "c-xfer", amount: 5000, is_income: true, deleted_at: null },
    { id: "main", transfer_group_id: "g2", account_id: "a-check", category_id: "c-food", amount: 2000, is_income: false, deleted_at: null },
    { id: "comp", transfer_group_id: "g2", account_id: "a-card", category_id: "c-xfer", amount: 2000, is_income: true, deleted_at: null },
  ]);

  // Addressed by the incoming leg; both legs still resolve.
  const [updatedOut, updatedIn] = await offlineAware.updateTransferOffline("in", {
    from_account_id: "a-check",
    to_account_id: "a-card",
    amount: 6000,
    description: "Moved",
    payee: "",
    transaction_date: "2026-03-05",
    category_id: "c-xfer",
  });
  assert.equal(updatedOut.id, "out");
  assert.equal(updatedIn.id, "in");
  assert.equal(updatedOut.amount, 6000);
  assert.equal(updatedIn.amount, 6000);
  assert.equal(updatedIn.account_id, "a-card");
  assert.deepEqual(updatedIn.accounts, { id: "a-card", name: "Card", type: "credit" });
  assert.equal(updatedIn.payee, null);
  assert.equal(updatedIn.transaction_date, "2026-03-05");

  const [updatedMain, updatedComp] = await offlineAware.updateLinkedTransferOffline("comp", {
    account_id: "a-save",
    linked_account_id: "a-card",
    category_id: "c-rent",
    amount: 2500,
    companion_amount: 2400,
    description: "Rent",
    transaction_date: "2026-03-06",
    is_income: false,
  });
  assert.equal(updatedMain.id, "main");
  assert.equal(updatedMain.category_id, "c-rent");
  assert.equal(updatedMain.categories.name, "Rent");
  assert.equal(updatedMain.amount, 2500);
  assert.equal(updatedMain.account_id, "a-save");
  assert.equal(updatedComp.id, "comp");
  assert.equal(updatedComp.category_id, "c-xfer");
  assert.equal(updatedComp.amount, 2400);
  assert.equal(updatedComp.is_income, true);

  assert.deepEqual(await pendingActions(db), {
    out: "update",
    in: "update",
    main: "update",
    comp: "update",
  });
});

test("APP-1: bulk update offline applies the RPC's field rules row by row", async () => {
  const { offlineAware, offlineDb, db } = await loadOfflineAware();
  await seedLookups(db);
  await db.transactions.bulkPut([
    { id: "t1", category_id: "c-food", account_id: "a-check", amount: 100, description: "one", payee: "Shop", deleted_at: null },
    { id: "t2", category_id: "c-food", account_id: "a-check", amount: 200, description: "two", payee: "Shop", deleted_at: null },
    { id: "gone", category_id: "c-food", account_id: "a-check", amount: 300, deleted_at: "2026-01-01T00:00:00.000Z" },
  ]);

  const rows = await offlineAware.bulkUpdateTransactionsOffline([
    { id: "t1", category_id: "c-rent", description: "  trimmed ", amount: undefined },
    { id: "t2", payee: "  ", user_id: "someone-else" },
    { id: "gone", amount: 999 },
    { id: "missing", amount: 999 },
  ]);

  assert.deepEqual(rows.map((r) => r.id), ["t1", "t2"]);
  const [t1, t2] = rows;
  assert.equal(t1.category_id, "c-rent");
  assert.equal(t1.categories.name, "Rent");
  assert.equal(t1.description, "trimmed");
  assert.equal(t1.amount, 100); // undefined leaves the column alone
  assert.equal(t2.payee, null);
  assert.equal(t2.user_id, undefined); // not a column the RPC updates
  assert.equal((await db.transactions.get("gone")).amount, 300);
  assert.deepEqual(await pendingActions(db), { t1: "update", t2: "update" });
  assert.equal(await offlineDb.getPendingSyncCount(), 2);
  assert.deepEqual(await offlineAware.bulkUpdateTransactionsOffline([]), []);
});

test("APP-1: confirm, skip and bulk delete work offline", async () => {
  const { offlineAware, offlineDb, db } = await loadOfflineAware();
  await db.transactions.bulkPut([
    { id: "p1", status: "pending", amount: 100, deleted_at: null },
    { id: "p2", status: "pending", amount: 200, deleted_at: null },
    { id: "p3", status: "projected", amount: 300, deleted_at: null },
    { id: "p4", status: "projected", amount: 400, deleted_at: null },
    ...transferRows(),
  ]);

  const confirmed = await offlineAware.confirmTransactionOffline("p1");
  assert.equal(confirmed.status, "posted");
  assert.equal(confirmed.amount, 100);
  const bulkConfirmed = await offlineAware.bulkConfirmTransactionsOffline(["p2"]);
  assert.deepEqual(bulkConfirmed.map((r) => [r.id, r.status]), [["p2", "posted"]]);
  await assert.rejects(offlineAware.confirmTransactionOffline("missing"), /not found locally/);

  assert.equal(await offlineAware.skipTransactionOffline("p3"), "p3");
  assert.deepEqual(await offlineAware.bulkSkipTransactionsOffline(["p4"]), ["p4"]);
  // Skipping one leg leaves the companion alone, as the service does.
  assert.equal(await offlineAware.skipTransactionOffline("other-group"), "other-group");

  // Selecting both legs plus a plain row deletes each row once.
  const deleted = await offlineAware.bulkDeleteTransactionsOffline(["out", "in", "plain"]);
  assert.deepEqual(deleted.sort(), ["in", "out", "plain"]);

  assert.deepEqual(await pendingActions(db), {
    p1: "update",
    p2: "update",
    p3: "delete",
    p4: "delete",
    "other-group": "delete",
    out: "delete",
    in: "delete",
    plain: "delete",
  });
  for (const id of ["p3", "p4", "other-group", "out", "in", "plain"]) {
    assert.ok((await db.transactions.get(id)).deleted_at, `${id} should be soft-deleted`);
  }
  assert.equal((await db.transactions.get("gone"))._offline, undefined);
  assert.equal(await offlineDb.getPendingSyncCount(), 8);
});

test("APP-1: online actions call the service and mirror the result into Dexie", async () => {
  setOnline(true);
  const calls = [];
  const record = (name, result) => async (...args) => {
    calls.push([name, ...args]);
    return typeof result === "function" ? result(...args) : result;
  };
  const { offlineAware, offlineDb, db, flushes } = await loadOfflineAware({
    services: {
      "./transactions": {
        bulkUpdateTransactions: record("bulkUpdate", (updates) =>
          updates.map((u) => ({ ...u, amount: 100, categories: { id: u.category_id, name: "Rent" } })),
        ),
        bulkConfirmTransactions: record("bulkConfirm", (ids) =>
          ids.map((id) => ({ id, status: "posted", amount: 100 })),
        ),
        bulkSkipTransactions: record("bulkSkip", (ids) => ids),
        deleteTransaction: record("delete", (id) => (id === "out" ? ["out", "in"] : [id])),
        createTransfer: record("createTransfer", [
          { id: "new-out", is_income: false, amount: 900 },
          { id: "new-in", is_income: true, amount: 900 },
        ]),
        updateTransfer: record("updateTransfer", [
          { id: "out", is_income: false, amount: 7000, transfer_group_id: "g1", deleted_at: null },
          { id: "in", is_income: true, amount: 7000, transfer_group_id: "g1", deleted_at: null },
        ]),
      },
    },
  });
  await db.transactions.bulkPut([
    { id: "t1", category_id: "c-food", amount: 100, status: "pending", deleted_at: null },
    { id: "p3", status: "projected", amount: 300, deleted_at: null },
    ...transferRows(),
  ]);

  const updated = await offlineAware.bulkUpdateTransactionsOffline([{ id: "t1", category_id: "c-rent" }]);
  assert.equal(updated[0].categories.name, "Rent");
  assert.equal((await db.transactions.get("t1")).category_id, "c-rent");

  const confirmed = await offlineAware.confirmTransactionOffline("t1");
  assert.equal(confirmed.status, "posted");
  assert.equal((await db.transactions.get("t1")).status, "posted");

  assert.equal(await offlineAware.skipTransactionOffline("p3"), "p3");
  assert.ok((await db.transactions.get("p3")).deleted_at);

  const created = await offlineAware.createTransferOffline({ category_id: "c-xfer", amount: 900 });
  assert.deepEqual(created.map((r) => r.id), ["new-out", "new-in"]);
  assert.equal((await db.transactions.get("new-in")).amount, 900);

  await offlineAware.updateTransferOffline("out", { amount: 7000 });
  assert.equal((await db.transactions.get("in")).amount, 7000);

  const deleted = await offlineAware.bulkDeleteTransactionsOffline(["out", "plain"]);
  assert.deepEqual(deleted.sort(), ["in", "out", "plain"]);
  for (const id of deleted) assert.ok((await db.transactions.get(id)).deleted_at);

  assert.deepEqual(calls.map(([name]) => name), [
    "bulkUpdate",
    "bulkConfirm",
    "bulkSkip",
    "createTransfer",
    "updateTransfer",
    "delete",
    "delete",
  ]);
  assert.deepEqual(flushes, []);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
  assert.equal((await db.transactions.toArray()).some((r) => r._offline === 1), false);
});

// ── OFF-4: a row edited during its own push stays queued ──

test("OFF-4: markSynced keeps a row that changed after the pushed snapshot", async () => {
  const { offlineDb, db } = await loadOfflineDb();
  await offlineDb.putOffline("transactions", { id: "t1", amount: 100 }, "update");
  await offlineDb.putOffline("transactions", { id: "t2", amount: 100 }, "update");
  await db.transactions.update("t1", { _offlineAt: "2026-03-01T10:00:00.000Z" });
  await db.transactions.update("t2", { _offlineAt: "2026-03-01T10:00:00.000Z" });
  // t1 is edited again while its 10:00:00 snapshot is being pushed.
  await db.transactions.update("t1", { amount: 250, _offlineAt: "2026-03-01T10:00:05.000Z" });

  assert.equal(await offlineDb.markSynced("transactions", "t1", "2026-03-01T10:00:00.000Z"), false);
  assert.equal(await offlineDb.markSynced("transactions", "t2", "2026-03-01T10:00:00.000Z"), true);

  const kept = await db.transactions.get("t1");
  assert.equal(kept._offline, 1);
  assert.equal(kept._action, "update");
  assert.equal(kept.amount, 250);
  assert.equal((await db.transactions.get("t2"))._offline, 0);
  assert.equal(await offlineDb.getPendingSyncCount(), 1);

  // Pushing the newer snapshot clears it.
  assert.equal(await offlineDb.markSynced("transactions", "t1", "2026-03-01T10:00:05.000Z"), true);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
});

test("OFF-4: markSynced without a snapshot timestamp still clears the row", async () => {
  const { offlineDb, db } = await loadOfflineDb();
  await offlineDb.putOffline("accounts", { id: "a1", name: "Cash" }, "create");
  assert.equal(await offlineDb.markSynced("accounts", "a1"), true);
  assert.equal((await db.accounts.get("a1"))._offline, 0);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
});

test("OFF-4: an edit made while its row is being pushed is pushed too, not dropped", async () => {
  setOnline(true);
  const { offlineDb, db } = await loadOfflineDb();
  const syncQueue = await load(sources.syncQueue, { "../services/offlineDb": { ...offlineDb } });
  await offlineDb.putOffline("transactions", { id: "t1", user_id: "user-1", amount: 100 }, "update");
  await db.transactions.update("t1", { _offlineAt: "2026-03-01T10:00:00.000Z" });

  let edited = false;
  const { sync, calls } = await loadSync({
    modules: { offlineDb: { ...offlineDb }, syncQueue: { ...syncQueue } },
    onCall: async () => {
      if (edited) return;
      edited = true;
      // The user changes the row again before the first push returns.
      const row = await db.transactions.get("t1");
      await db.transactions.put({ ...row, amount: 250, _offlineAt: "2026-03-01T10:00:05.000Z" });
    },
  });
  await sync.requestSync({ skipPull: true });

  assert.deepEqual(
    calls.map((c) => [c.method, c.value, c.payload.amount]),
    [
      ["update", "t1", 100],
      ["update", "t1", 250],
    ],
  );
  const row = await db.transactions.get("t1");
  assert.equal(row.amount, 250);
  assert.equal(row._offline, 0);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
  assert.deepEqual(sync.getSyncState().progress, { done: 2, total: 2 });
  assert.equal(sync.getSyncState().error, null);
});

test("OFF-4: a row that keeps changing does not keep the sync running", async () => {
  setOnline(true);
  const { offlineDb, db } = await loadOfflineDb();
  const syncQueue = await load(sources.syncQueue, { "../services/offlineDb": { ...offlineDb } });
  await offlineDb.putOffline("transactions", { id: "t1", user_id: "user-1", amount: 0 }, "update");

  let edits = 0;
  const { sync, calls } = await loadSync({
    modules: { offlineDb: { ...offlineDb }, syncQueue: { ...syncQueue } },
    onCall: async () => {
      edits += 1;
      const row = await db.transactions.get("t1");
      await db.transactions.put({ ...row, amount: edits, _offlineAt: `edit-${edits}` });
    },
  });
  await sync.requestSync({ skipPull: true });

  assert.equal(calls.length, 3);
  // The last edit is still queued for the next sync.
  const row = await db.transactions.get("t1");
  assert.equal(row._offline, 1);
  assert.equal(row.amount, 3);
  assert.equal(await offlineDb.getPendingSyncCount(), 1);
});

// ── OFF-5: creates carry a client-generated id ──

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// A backend whose insert commits but whose response never arrives.
const lostResponse = (sent) => async (params) => {
  sent.push(params);
  throw new TypeError("Failed to fetch");
};

const newTransaction = {
  account_id: "a-check",
  category_id: "c-food",
  amount: 1250,
  description: "Lunch",
  transaction_date: "2026-03-01",
  is_income: false,
};

test("OFF-5: an online create sends a client-generated id", async () => {
  setOnline(true);
  const sent = [];
  const { offlineAware, db } = await loadOfflineAware({
    services: {
      "./transactions": {
        createTransaction: async (params) => {
          sent.push(params);
          return { ...params, user_id: "user-1" };
        },
      },
    },
  });

  // An `id` on the form values must not be used as the row id.
  const created = await offlineAware.createTransactionOffline({ ...newTransaction, id: "form-id" });

  assert.equal(sent.length, 1);
  assert.match(sent[0].id, UUID);
  assert.equal(created.id, sent[0].id);
  assert.deepEqual((await db.transactions.toArray()).map((r) => r.id), [sent[0].id]);
  assert.equal((await db.transactions.get(created.id))._offline, undefined);
});

test("OFF-5: a create whose response is lost is queued under the id already sent", async () => {
  setOnline(true);
  const sent = [];
  const { offlineAware, offlineDb, db } = await loadOfflineAware({
    services: {
      "./transactions": {
        createTransaction: lostResponse(sent),
        createAdjustment: lostResponse(sent),
      },
    },
  });

  const created = await offlineAware.createTransactionOffline(newTransaction);
  const adjustment = await offlineAware.createAdjustmentOffline(newTransaction);

  assert.match(sent[0].id, UUID);
  assert.equal(created.id, sent[0].id);
  assert.equal(adjustment.id, sent[1].id);
  assert.notEqual(created.id, adjustment.id);
  // One local row per create, queued as a create so sync upserts on that id.
  assert.deepEqual(await pendingActions(db), {
    [created.id]: "create",
    [adjustment.id]: "create",
  });
  assert.equal(await db.transactions.count(), 2);
  assert.equal(await offlineDb.getPendingSyncCount(), 2);
});

test("OFF-5: transfer creates reuse the leg and group ids that were sent", async () => {
  setOnline(true);
  const sent = [];
  const { offlineAware, db } = await loadOfflineAware({
    services: {
      "./transactions": {
        createTransfer: lostResponse(sent),
        createAsymmetricTransfer: lostResponse(sent),
        createLinkedTransfer: lostResponse(sent),
      },
    },
  });
  await seedLookups(db);

  const transfer = { from_account_id: "a-check", to_account_id: "a-save", description: "Move", transaction_date: "2026-03-01", category_id: "c-xfer" };
  const [out, inc] = await offlineAware.createTransferOffline({ ...transfer, amount: 5000 });
  const [aOut, aIn] = await offlineAware.createAsymmetricTransferOffline({ ...transfer, from_amount: 5000, to_amount: 4900 });
  const [main, companion] = await offlineAware.createLinkedTransferOffline({
    ...newTransaction,
    linked_account_id: "a-card",
  });

  for (const [params, first, second] of [
    [sent[0], out, inc],
    [sent[1], aOut, aIn],
  ]) {
    assert.match(params.outgoing_id, UUID);
    assert.equal(first.id, params.outgoing_id);
    assert.equal(second.id, params.incoming_id);
    assert.equal(first.transfer_group_id, params.transfer_group_id);
    assert.equal(second.transfer_group_id, params.transfer_group_id);
  }
  assert.equal(main.id, sent[2].id);
  assert.equal(companion.id, sent[2].companion_id);
  assert.equal(main.transfer_group_id, sent[2].transfer_group_id);
  assert.equal(companion.transfer_group_id, sent[2].transfer_group_id);

  const ids = [out, inc, aOut, aIn, main, companion].map((r) => r.id);
  assert.equal(new Set(ids).size, 6);
  assert.equal(await db.transactions.count(), 6);
});

test("OFF-5: ids are still generated where crypto.randomUUID is unavailable", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues: (array) => realCrypto.getRandomValues(array) },
    configurable: true,
    writable: true,
  });
  try {
    const { offlineAware } = await loadOfflineAware();
    const first = await offlineAware.createTransactionOffline(newTransaction);
    const second = await offlineAware.createTransactionOffline(newTransaction);
    assert.match(first.id, UUID);
    assert.match(second.id, UUID);
    assert.notEqual(first.id, second.id);
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});

async function loadTransactionsService() {
  const inserts = [];
  const supabase = {
    from(table) {
      let payload;
      const query = {
        insert(rows) {
          payload = rows;
          inserts.push({ table, rows });
          return query;
        },
        then(resolve, reject) {
          let data = [{ id: "c-xfer" }]; // the Account Transfer category lookup
          if (payload) data = payload;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      for (const method of ["select", "eq", "ilike", "limit", "single"]) query[method] = () => query;
      return query;
    },
  };
  const { offlineDb } = await loadOfflineDb();
  const modules = {
    "./supabase": { supabase, getCurrentUser: async () => ({ id: "user-1" }) },
    "./offlineDb": { ...offlineDb },
    "../utils/ids": { ...(await load(sources.ids, {})) },
  };
  const service = await load(sources.transactions, modules);
  return { service, inserts, modules };
}

test("OFF-5: transaction create services insert the supplied ids", async () => {
  const { service, inserts } = await loadTransactionsService();

  await service.createTransaction({ ...newTransaction, id: "tx-1" });
  await service.createAdjustment({ ...newTransaction, id: "adj-1" });
  await service.createTransfer({
    from_account_id: "a-check", to_account_id: "a-save", amount: 5000, description: "Move",
    transaction_date: "2026-03-01", category_id: "c-xfer",
    transfer_group_id: "g-1", outgoing_id: "out-1", incoming_id: "in-1",
  });
  await service.createAsymmetricTransfer({
    from_account_id: "a-check", to_account_id: "a-save", from_amount: 5000, to_amount: 4900, description: "Move",
    transaction_date: "2026-03-01", category_id: "c-xfer",
    transfer_group_id: "g-2", outgoing_id: "out-2", incoming_id: "in-2",
  });
  await service.createLinkedTransfer({
    ...newTransaction, linked_account_id: "a-card",
    transfer_group_id: "g-3", id: "main-3", companion_id: "comp-3",
  });

  const rows = inserts.map((i) => i.rows);
  assert.equal(rows[0].id, "tx-1");
  assert.equal(rows[0].user_id, "user-1");
  assert.equal(rows[1].id, "adj-1");
  assert.deepEqual(rows[2].map((r) => [r.id, r.is_income, r.transfer_group_id]), [
    ["out-1", false, "g-1"],
    ["in-1", true, "g-1"],
  ]);
  assert.deepEqual(rows[3].map((r) => [r.id, r.amount, r.transfer_group_id]), [
    ["out-2", 5000, "g-2"],
    ["in-2", 4900, "g-2"],
  ]);
  assert.deepEqual(rows[4].map((r) => [r.id, r.account_id, r.category_id, r.transfer_group_id]), [
    ["main-3", "a-check", "c-food", "g-3"],
    ["comp-3", "a-card", "c-xfer", "g-3"],
  ]);
});

test("OFF-5: without supplied ids the services leave id generation to the database", async () => {
  const { service, inserts } = await loadTransactionsService();

  await service.createTransaction(newTransaction);
  await service.createTransfer({
    from_account_id: "a-check", to_account_id: "a-save", amount: 5000, description: "Move",
    transaction_date: "2026-03-01", category_id: "c-xfer",
    outgoing_id: "only-one", // a lone id is ignored: bulk rows must share keys
  });

  assert.equal("id" in inserts[0].rows, false);
  const legs = inserts[1].rows;
  assert.equal(legs.some((r) => "id" in r), false);
  assert.match(legs[0].transfer_group_id, UUID);
  assert.equal(legs[0].transfer_group_id, legs[1].transfer_group_id);
});

// ══ Review follow-ups ══

// A gate a stubbed backend call can wait on until the test releases it.
function gate() {
  let release;
  let reached;
  const released = new Promise((resolve) => (release = resolve));
  const arrived = new Promise((resolve) => (reached = resolve));
  return { wait: () => (reached(), released), release, arrived };
}

// ── 1: writes that reference a pending account / category / plan ──

async function withPendingLookups(options = {}) {
  const ctx = await loadOfflineAware(options);
  const { offlineAware } = ctx;
  const account = await offlineAware.createAccountOffline({ name: "New account", type: "checking" });
  const category = await offlineAware.createCategoryOffline({ name: "New category", type: "needs", color: "#111" });
  const plan = await offlineAware.createBudgetPlanOffline({ month: 3, year: 2026, total_income: 500000 });
  setOnline(true); // back online, nothing pushed yet
  return { ...ctx, account, category, plan };
}

const refusingServices = {
  "./transactions": {
    createTransaction: failIfCalled("createTransaction"),
    updateTransaction: failIfCalled("updateTransaction"),
    createTransfer: failIfCalled("createTransfer"),
    bulkUpdateTransactions: failIfCalled("bulkUpdateTransactions"),
  },
  "./budgets": { upsertBudgetItem: failIfCalled("upsertBudgetItem") },
};

test("follow-up 1: a create referencing an unsynced account or category is queued behind it", async () => {
  const { offlineAware, db, account, category, flushes, scheduled } = await withPendingLookups({
    services: refusingServices,
  });

  const viaAccount = await offlineAware.createTransactionOffline({ ...newTransaction, account_id: account.id });
  const viaCategory = await offlineAware.createTransactionOffline({ ...newTransaction, category_id: category.id });
  const [out, inc] = await offlineAware.createTransferOffline({
    from_account_id: "a-check",
    to_account_id: account.id,
    amount: 5000,
    description: "Move",
    transaction_date: "2026-03-01",
    category_id: "c-xfer",
  });

  assert.deepEqual(await pendingActions(db), {
    [viaAccount.id]: "create",
    [viaCategory.id]: "create",
    [out.id]: "create",
    [inc.id]: "create",
  });
  assert.equal(viaAccount.accounts.name, "New account");
  assert.equal(viaCategory.categories.name, "New category");
  // Each write tried to flush first, and each queued write asked for a push.
  assert.equal(flushes.length, 3);
  assert.ok(scheduled.length >= 3);
});

test("follow-up 1: an edit that moves a row onto an unsynced account or category is queued", async () => {
  const { offlineAware, db, account, category, plan } = await withPendingLookups({
    services: refusingServices,
  });
  await db.transactions.bulkPut([
    { id: "t1", account_id: "a-check", category_id: "c-food", amount: 100, deleted_at: null },
    { id: "t2", account_id: "a-check", category_id: "c-food", amount: 200, deleted_at: null },
  ]);

  await offlineAware.updateTransactionOffline("t1", { account_id: account.id });
  await offlineAware.bulkUpdateTransactionsOffline([{ id: "t2", category_id: category.id }]);
  const item = await offlineAware.upsertBudgetItemOffline({
    budget_plan_id: plan.id,
    category_id: "c-food",
    planned_amount: 40000,
  });

  assert.deepEqual(await pendingActions(db), { t1: "update", t2: "update" });
  assert.equal((await db.transactions.get("t1")).account_id, account.id);
  assert.equal((await db.transactions.get("t2")).category_id, category.id);
  const storedItem = await db.budget_items.get(item.id);
  assert.equal(storedItem._action, "create");
  assert.equal(storedItem.planned_amount, 40000);
});

test("follow-up 1: once the flush has pushed the referenced rows the write goes online", async () => {
  const sent = [];
  const { offlineAware, db, account } = await withPendingLookups({
    flush: flushAll,
    services: {
      "./transactions": {
        createTransaction: async (params) => {
          sent.push(params);
          return { ...params, user_id: "user-1" };
        },
      },
    },
  });

  const created = await offlineAware.createTransactionOffline({ ...newTransaction, account_id: account.id });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].account_id, account.id);
  assert.equal((await db.transactions.get(created.id))._offline, undefined);
});

// ── 2 & 3: queued-while-online writes get pushed; the flush wait is bounded ──

test("follow-up 2: a write queued while online asks for a push; an offline one does not", async () => {
  const { offlineAware, db, scheduled } = await loadOfflineAware({
    services: { "./transactions": { updateTransaction: failIfCalled("updateTransaction") } },
  });
  await db.transactions.put({ id: "t1", amount: 100 });

  await offlineAware.updateTransactionOffline("t1", { amount: 200 });
  assert.equal(scheduled.length, 0);

  setOnline(true);
  await offlineAware.updateTransactionOffline("t1", { amount: 300 }); // still pending → queued
  assert.ok(scheduled.length >= 1);
});

// The wrappers and the real sync engine over one fake Dexie, with a backend
// that records every call.
async function loadRealSync({ services = {}, onCall } = {}) {
  const base = await loadLocalStore();
  const { sync, calls } = await loadSync({
    modules: { offlineDb: { ...base.offlineDb }, syncQueue: { ...base.syncQueue } },
    onCall,
  });
  const { offlineAware } = await loadOfflineAware({ base, sync, services });
  return { ...base, sync, calls, offlineAware };
}

test("follow-up 2: a row queued during an in-flight sync is pushed by a follow-up sync", async () => {
  setOnline(true);
  const blocked = gate();
  let first = true;
  const { offlineAware, offlineDb, db, sync, calls } = await loadRealSync({
    services: { "./transactions": { createTransaction: lostResponse([]) } },
    onCall: () => {
      if (!first) return undefined;
      first = false;
      return blocked.wait();
    },
  });
  await offlineDb.putOffline("accounts", { id: "a1", user_id: "user-1", name: "Cash" }, "create");

  // A sync starts and is mid-push when a new row is queued.
  const running = sync.requestSync({ skipPull: true });
  await blocked.arrived;
  const created = await offlineAware.createTransactionOffline(newTransaction);
  blocked.release();
  await running;

  // The in-flight sync's snapshot did not include the new row.
  assert.deepEqual(calls.map((c) => c.table), ["accounts"]);
  assert.equal((await db.transactions.get(created.id))._offline, 1);

  // The scheduled push picks it up without any online / visibility event.
  mock.timers.tick(1500);
  await settle(() => calls.length === 2);
  await sync.requestSync({ skipPull: true }); // joins the follow-up if still running

  assert.deepEqual(calls.map((c) => [c.table, c.method]), [
    ["accounts", "upsert"],
    ["transactions", "upsert"],
  ]);
  assert.equal(calls[1].payload.id, created.id);
  assert.equal(calls[1].payload.user_id, "user-1");
  assert.equal((await db.transactions.get(created.id))._offline, 0);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
});

test("follow-up 3: a save does not hang on a slow in-flight sync", async () => {
  setOnline(true);
  const blocked = gate();
  let first = true;
  const { offlineAware, offlineDb, db, sync, calls } = await loadRealSync({
    services: { "./transactions": { updateTransaction: failIfCalled("updateTransaction") } },
    onCall: () => {
      if (!first) return undefined;
      first = false;
      return blocked.wait();
    },
  });
  await offlineDb.putOffline(
    "transactions",
    { id: "t1", user_id: "user-1", amount: 100, description: "edited offline", payee: "old" },
    "update",
  );
  await db.transactions.update("t1", { _offlineAt: "2026-03-01T10:00:00.000Z" });

  const running = sync.requestSync({ skipPull: true });
  await blocked.arrived;

  // The save waits for the flush, but only for a bounded time.
  let saved = null;
  const saving = offlineAware
    .updateTransactionOffline("t1", { payee: "edited online" })
    .then((row) => (saved = row));
  await settle();
  assert.equal(saved, null);
  mock.timers.tick(4000);
  await saving;

  assert.equal(saved.payee, "edited online");
  assert.equal(saved.description, "edited offline");
  assert.equal((await db.transactions.get("t1"))._offline, 1);

  // When the slow sync finishes it re-pushes the row with the newer edit.
  blocked.release();
  await running;
  assert.deepEqual(
    calls.map((c) => [c.method, c.payload.payee]),
    [
      ["update", "old"],
      ["update", "edited online"],
    ],
  );
  assert.equal((await db.transactions.get("t1"))._offline, 0);
});

// ── 4: caching a backend result must not clobber a newer queued change ──

test("follow-up 4: a row queued during the backend call is not overwritten by its result", async () => {
  setOnline(true);
  let offlineDbRef;
  const { offlineAware, offlineDb, db } = await loadOfflineAware({
    services: {
      "./transactions": {
        updateTransaction: async (id, updates) => {
          // Another write to the same row is queued while this call is in flight.
          const row = await offlineDbRef.db.transactions.get(id);
          await offlineDbRef.putOffline("transactions", { ...row, amount: 999 }, "update");
          return { id, amount: 100, payee: updates.payee };
        },
        bulkConfirmTransactions: async (ids) => {
          const row = await offlineDbRef.db.transactions.get("t2");
          await offlineDbRef.putOffline("transactions", { ...row, amount: 555 }, "update");
          return ids.map((id) => ({ id, status: "posted", amount: 1 }));
        },
      },
    },
  });
  offlineDbRef = offlineDb;
  await db.transactions.bulkPut([
    { id: "t1", amount: 100, payee: "old" },
    { id: "t2", amount: 200, status: "pending", deleted_at: null },
    { id: "t3", amount: 300, status: "pending", deleted_at: null },
  ]);

  await offlineAware.updateTransactionOffline("t1", { payee: "new" });
  await offlineAware.bulkConfirmTransactionsOffline(["t2", "t3"]);

  const t1 = await db.transactions.get("t1");
  assert.equal(t1.amount, 999);
  assert.equal(t1._offline, 1);
  assert.equal(t1._action, "update");
  const t2 = await db.transactions.get("t2");
  assert.equal(t2.amount, 555);
  assert.equal(t2._offline, 1);
  // Rows nobody touched meanwhile still take the backend result.
  assert.deepEqual(await db.transactions.get("t3"), { id: "t3", status: "posted", amount: 1 });
  assert.equal(await offlineDb.getPendingSyncCount(), 2);
});

// ── 6: pending counter vs. a scan that is still running ──

test("follow-up 6: writes made during the counter's first scan are all counted", async () => {
  const { offlineDb } = await loadOfflineDb();
  // No count has been read yet, so the first write starts the lazy scan.
  await offlineDb.putOffline("transactions", { id: "t1", amount: 1 }, "create");
  await offlineDb.putOffline("transactions", { id: "t2", amount: 2 }, "create");
  await offlineDb.putOffline("accounts", { id: "a1", name: "Cash" }, "create");
  assert.equal(await offlineDb.getPendingSyncCount(), 3);
});

test("follow-up 6: a scan that started before a wipe cannot restore the old count", async () => {
  const { offlineDb, db } = await loadOfflineDb();
  await db.transactions.bulkPut([
    { id: "t1", _offline: 1, _action: "create" },
    { id: "t2", _offline: 1, _action: "create" },
  ]);
  // Hold the scan on its last table until after the wipe.
  const blocked = gate();
  const realWhere = db.recurring_templates.where.bind(db.recurring_templates);
  db.recurring_templates.where = () => ({
    equals: () => ({ count: async () => (await blocked.wait(), 0) }),
  });

  const counting = offlineDb.getPendingSyncCount();
  await blocked.arrived;
  await offlineDb.clearAllOfflineData();
  db.recurring_templates.where = realWhere;
  blocked.release();

  assert.equal(await counting, 0);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
});

// ── 7: multi-row queue writes are all-or-nothing ──

test("follow-up 7: both legs of a transfer are queued in one transaction", async () => {
  const { offlineAware, offlineDb, db } = await loadOfflineAware();
  await seedLookups(db);
  const transfer = {
    from_account_id: "a-check",
    to_account_id: "a-save",
    amount: 5000,
    description: "Move",
    transaction_date: "2026-03-01",
    category_id: "c-xfer",
  };

  db.transactionLog.length = 0;
  const [out, inc] = await offlineAware.createTransferOffline(transfer);
  assert.deepEqual(db.transactionLog, [{ mode: "rw", tables: [db.transactions] }]);
  const stored = await db.transactions.bulkGet([out.id, inc.id]);
  assert.ok(stored.every((row) => row._offline === 1 && row._action === "create"));
  assert.equal(stored[0]._offlineAt !== undefined, true);

  // A failed write leaves neither leg behind and does not move the counter.
  db.transactions.failBulkPut = true;
  await assert.rejects(offlineAware.createTransferOffline(transfer), /bulkPut failed/);
  await assert.rejects(
    offlineAware.updateTransferOffline(out.id, { ...transfer, amount: 7000 }),
    /bulkPut failed/,
  );
  db.transactions.failBulkPut = false;

  assert.equal(await db.transactions.count(), 2);
  assert.equal((await db.transactions.get(out.id)).amount, 5000);
  assert.equal((await db.transactions.get(inc.id)).amount, 5000);
  assert.equal(await offlineDb.getPendingSyncCount(), 2);
});

// ── 8: client ids for the remaining creates ──

test("follow-up 8: account, category and budget plan creates send a client id", async () => {
  setOnline(true);
  const sent = [];
  const echo = async (params) => {
    sent.push(params);
    return { ...params, user_id: "user-1" };
  };
  const { offlineAware, db } = await loadOfflineAware({
    services: {
      "./accounts": { createAccount: echo },
      "./categories": { createCategory: echo },
      "./budgets": { createBudgetPlan: echo },
    },
  });

  const account = await offlineAware.createAccountOffline({ name: "Cash", type: "checking" });
  const category = await offlineAware.createCategoryOffline({ name: "Food", type: "needs", color: "#111" });
  const plan = await offlineAware.createBudgetPlanOffline({ month: 3, year: 2026, total_income: 500000 });

  for (const [i, row] of [account, category, plan].entries()) {
    assert.match(sent[i].id, UUID);
    assert.equal(row.id, sent[i].id);
  }
  assert.equal((await db.accounts.get(account.id))._offline, undefined);
  assert.equal(await db.categories.count(), 1);
  assert.equal(await db.budget_plans.count(), 1);
});

test("follow-up 8: a lost response queues the account, category or plan under the id sent", async () => {
  setOnline(true);
  const sent = [];
  const { offlineAware, offlineDb, db } = await loadOfflineAware({
    services: {
      "./accounts": { createAccount: lostResponse(sent) },
      "./categories": { createCategory: lostResponse(sent) },
      "./budgets": { createBudgetPlan: lostResponse(sent) },
    },
  });

  const account = await offlineAware.createAccountOffline({ name: "Cash", type: "checking" });
  const category = await offlineAware.createCategoryOffline({ name: "Food", type: "needs", color: "#111" });
  const plan = await offlineAware.createBudgetPlanOffline({ month: 3, year: 2026, total_income: 500000 });

  assert.equal(account.id, sent[0].id);
  assert.equal(category.id, sent[1].id);
  assert.equal(plan.id, sent[2].id);
  assert.equal((await db.accounts.get(account.id))._action, "create");
  assert.equal((await db.categories.get(category.id))._action, "create");
  assert.equal((await db.budget_plans.get(plan.id))._action, "create");
  assert.equal(await offlineDb.getPendingSyncCount(), 3);
});

test("follow-up 8: account, category and budget plan services insert a supplied id", async () => {
  const { inserts, modules } = await loadTransactionsService();
  const categories = await load(sources.categories, modules);
  const budgets = await load(sources.budgets, modules);
  const accounts = await load(sources.accounts, {
    ...modules,
    "./categories": { ...categories },
  });

  await accounts.createAccount({ name: " Cash ", type: "checking", id: "acct-1" });
  await accounts.createAccount({ name: "Other", type: "checking" });
  await categories.createCategory({ name: "Food", type: "needs", color: "#111", id: "cat-1" });
  await categories.createCategory({ name: "Rent", type: "needs", color: "#222" });
  await budgets.createBudgetPlan({ month: 3, year: 2026, total_income: 500000, id: "plan-1" });
  await budgets.createBudgetPlan({ month: 4, year: 2026, total_income: 500000 });

  const rows = inserts.map((i) => [i.table, i.rows.id, "id" in i.rows]);
  assert.deepEqual(rows, [
    ["accounts", "acct-1", true],
    ["accounts", undefined, false],
    ["categories", "cat-1", true],
    ["categories", undefined, false],
    ["budget_plans", "plan-1", true],
    ["budget_plans", undefined, false],
  ]);
  assert.equal(inserts[0].rows.name, "Cash");
  assert.equal(inserts[0].rows.user_id, "user-1");
});

test("follow-up 8: transfer group ids are generated where crypto.randomUUID is unavailable", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const realCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    value: { getRandomValues: (array) => realCrypto.getRandomValues(array) },
    configurable: true,
    writable: true,
  });
  try {
    const { service, inserts } = await loadTransactionsService();
    await service.createTransfer({
      from_account_id: "a-check", to_account_id: "a-save", amount: 5000, description: "Move",
      transaction_date: "2026-03-01", category_id: "c-xfer",
    });
    assert.match(inserts[0].rows[0].transfer_group_id, UUID);

    const { offlineAware } = await loadOfflineAware();
    await offlineAware.setUserPreferenceOffline("theme", "dark");
    const item = await offlineAware.upsertBudgetItemOffline({ budget_plan_id: "p1", category_id: "c1", planned_amount: 100 });
    assert.match(item.id, UUID);
  } finally {
    Object.defineProperty(globalThis, "crypto", original);
  }
});

// ── 9: non-transaction wrappers keep an unsynced create a create ──

test("follow-up 9: edits to unsynced creates stay queued creates in every wrapper", async () => {
  const refuse = (...names) => Object.fromEntries(names.map((n) => [n, failIfCalled(n)]));
  const { offlineAware, offlineDb, db, account, category, plan } = await withPendingLookups({
    services: {
      "./accounts": refuse("updateAccount", "closeAccount", "reopenAccount"),
      "./categories": refuse("updateCategory", "setUserPreference", "setCategoryArchived"),
      "./budgets": refuse("updateBudgetPlan", "upsertBudgetItem"),
      "./recurring": refuse("pauseRecurringTemplate", "resumeRecurringTemplate"),
    },
  });
  // Rows created offline earlier that only exist locally so far.
  setOnline(false);
  await offlineAware.setUserPreferenceOffline("theme", "dark");
  const item = await offlineAware.upsertBudgetItemOffline({ budget_plan_id: "p-synced", category_id: "c-food", planned_amount: 100 });
  await offlineDb.putOffline("recurring_templates", { id: "r1", category_id: "c-food", is_paused: false }, "create");
  setOnline(true);

  await offlineAware.updateAccountOffline(account.id, { name: "Renamed" });
  await offlineAware.closeAccountOffline(account.id, "2026-03-01");
  await offlineAware.reopenAccountOffline(account.id);
  await offlineAware.updateCategoryOffline(category.id, { name: "Renamed category" });
  await offlineAware.updateBudgetPlanOffline(plan.id, { total_income: 600000 });
  await offlineAware.upsertBudgetItemOffline({ budget_plan_id: "p-synced", category_id: "c-food", planned_amount: 250 });
  await offlineAware.setUserPreferenceOffline("theme", "light");
  await offlineAware.pauseRecurringTemplateOffline("r1");
  await offlineAware.resumeRecurringTemplateOffline("r1");

  const acct = await db.accounts.get(account.id);
  assert.deepEqual([acct._action, acct.name, acct.closed_at], ["create", "Renamed", null]);
  const cat = await db.categories.get(category.id);
  assert.deepEqual([cat._action, cat.name], ["create", "Renamed category"]);
  const storedPlan = await db.budget_plans.get(plan.id);
  assert.deepEqual([storedPlan._action, storedPlan.total_income], ["create", 600000]);
  const storedItem = await db.budget_items.get(item.id);
  assert.deepEqual([storedItem._action, storedItem.planned_amount], ["create", 250]);
  assert.equal(await db.budget_items.count(), 1);
  const prefs = await db.user_preferences.toArray();
  assert.deepEqual(prefs.map((p) => [p._action, p.preference_value]), [["create", "light"]]);
  const template = await db.recurring_templates.get("r1");
  assert.deepEqual([template._action, template.is_paused], ["create", false]);
  assert.equal(await offlineDb.getPendingSyncCount(), 6);
});

// ── OFF-8: natural-key tables ──

test("OFF-8: a preference cached under a placeholder id is pushed on its natural key", async () => {
  setOnline(true);
  const base = await loadLocalStore();
  const { offlineDb, db } = base;
  // Cached while online: the service only returns the value, so the local
  // row has a made-up id and no user_id. It is then changed offline.
  await offlineDb.putOffline(
    "user_preferences",
    { id: "placeholder", user_id: null, preference_key: "theme", preference_value: "dark", created_at: "c", updated_at: "u" },
    "update",
  );
  const serverRow = { id: "server-id", user_id: "user-1", preference_key: "theme", preference_value: "dark", updated_at: "u" };
  const { sync, calls } = await loadSync({
    modules: { offlineDb: { ...offlineDb }, syncQueue: { ...base.syncQueue } },
    respond: () => ({ data: serverRow, error: null }),
  });
  await sync.requestSync({ skipPull: true });

  assert.deepEqual(calls, [
    {
      table: "user_preferences",
      method: "upsert",
      // No id (the server row keeps its primary key) and a real user_id.
      payload: { user_id: "user-1", preference_key: "theme", preference_value: "dark", updated_at: "u" },
      options: { onConflict: "user_id,preference_key" },
    },
  ]);
  // The local row now is the server row.
  assert.deepEqual(await db.user_preferences.toArray(), [serverRow]);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
  assert.equal(sync.getSyncState().error, null);
});

test("OFF-8: an offline budget plan that collides with a server plan merges into it", async () => {
  setOnline(true);
  const base = await loadLocalStore();
  const { offlineDb, db } = base;
  await offlineDb.putOffline(
    "budget_plans",
    { id: "local-plan", user_id: null, month: 3, year: 2026, total_income: 500000, created_at: "c", updated_at: "u" },
    "create",
  );
  await offlineDb.putOffline(
    "budget_items",
    { id: "item-1", budget_plan_id: "local-plan", category_id: "c-food", planned_amount: 40000 },
    "create",
  );
  await db.budget_items.put({ id: "item-2", budget_plan_id: "local-plan", category_id: "c-rent", planned_amount: 1 });

  const serverPlan = { id: "server-plan", user_id: "user-1", month: 3, year: 2026, total_income: 500000 };
  const { sync, calls } = await loadSync({
    modules: { offlineDb: { ...offlineDb }, syncQueue: { ...base.syncQueue } },
    respond: (call) => {
      if (call.table !== "budget_plans") return undefined;
      // The id-keyed create hits UNIQUE (user_id, month, year).
      if (call.options.onConflict === "id") return { error: { code: "23505", message: "duplicate key" } };
      return { data: serverPlan, error: null };
    },
  });
  await sync.requestSync({ skipPull: true });

  assert.deepEqual(calls.map((c) => [c.table, c.options.onConflict]), [
    ["budget_plans", "id"],
    ["budget_plans", "user_id,month,year"],
    ["budget_items", "id"],
  ]);
  assert.deepEqual(calls[1].payload, { user_id: "user-1", month: 3, year: 2026, total_income: 500000, updated_at: "u" });
  // The item in this run's snapshot is pushed against the server plan.
  assert.equal(calls[2].payload.budget_plan_id, "server-plan");

  assert.deepEqual(await db.budget_plans.toArray(), [serverPlan]);
  const items = await db.budget_items.toArray();
  assert.deepEqual(items.map((i) => [i.id, i.budget_plan_id]).sort(), [
    ["item-1", "server-plan"],
    ["item-2", "server-plan"],
  ]);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
  assert.equal(sync.getSyncState().error, null);
});

test("OFF-8: other unique violations still fail the push and leave the row queued", async () => {
  setOnline(true);
  const base = await loadLocalStore();
  await base.offlineDb.putOffline("accounts", { id: "a1", user_id: "user-1", name: "Cash" }, "create");
  const { sync, calls } = await loadSync({
    modules: { offlineDb: { ...base.offlineDb }, syncQueue: { ...base.syncQueue } },
    respond: () => ({ error: { code: "23505", message: "duplicate account name" } }),
  });
  await sync.requestSync({ skipPull: true });

  assert.equal(calls.length, 1);
  assert.equal((await base.db.accounts.get("a1"))._offline, 1);
  assert.equal(sync.getSyncState().error, "duplicate account name");
});

test("OFF-8: a row edited while its natural-key push is in flight stays queued under the server id", async () => {
  const { offlineDb, db } = await loadOfflineDb();
  await offlineDb.putOffline("user_preferences", { id: "placeholder", preference_key: "theme", preference_value: "dark" }, "create");
  const pushed = await db.user_preferences.get("placeholder");
  await db.user_preferences.update("placeholder", { preference_value: "light", _offlineAt: "later" });

  const cleared = await offlineDb.adoptServerRow("user_preferences", pushed, {
    id: "server-id", user_id: "user-1", preference_key: "theme", preference_value: "dark",
  });

  assert.equal(cleared, false);
  const rows = await db.user_preferences.toArray();
  assert.deepEqual(rows.map((r) => [r.id, r.preference_value, r._offline, r._action]), [
    ["server-id", "light", 1, "update"],
  ]);
  assert.equal(await offlineDb.getPendingSyncCount(), 1);
});

test("OFF-8: pulled server rows replace placeholders but not pending rows with the same natural key", async () => {
  const { offlineDb, db } = await loadOfflineDb();
  await db.user_preferences.bulkPut([
    { id: "placeholder", user_id: null, preference_key: "theme", preference_value: "dark" },
  ]);
  await offlineDb.putOffline("user_preferences", { id: "local-new", user_id: null, preference_key: "currency", preference_value: "EUR" }, "create");
  await offlineDb.putOffline("budget_plans", { id: "local-plan", month: 3, year: 2026, total_income: 1 }, "create");

  const server = [
    { id: "srv-theme", user_id: "user-1", preference_key: "theme", preference_value: "dark" },
    { id: "srv-currency", user_id: "user-1", preference_key: "currency", preference_value: "USD" },
  ];
  await offlineDb.cacheTableIncremental("user_preferences", server);
  await offlineDb.cacheTable("budget_plans", [
    { id: "srv-plan", month: 3, year: 2026, total_income: 2 },
    { id: "srv-april", month: 4, year: 2026, total_income: 3 },
  ]);

  const prefs = await db.user_preferences.toArray();
  assert.deepEqual(prefs.map((p) => [p.id, p.preference_value]).sort(), [
    ["local-new", "EUR"], // pending local change wins over the server row
    ["srv-theme", "dark"], // placeholder replaced by the real row
  ]);
  const plans = await db.budget_plans.toArray();
  assert.deepEqual(plans.map((p) => p.id).sort(), ["local-plan", "srv-april"]);
  assert.equal(await offlineDb.getPendingSyncCount(), 2);
});

// ── OFF-10: revalidation must not delete rows newer than its fetch ──

test("OFF-10: a row created after a revalidation fetch started survives its reconcile", async () => {
  setOnline(true);
  const blocked = gate();
  const march = { transaction_date: "2026-03-10", status: "posted", deleted_at: null };
  const serverRows = [{ id: "kept", amount: 100, ...march }];
  const { offlineAware, db, cache } = await loadOfflineAware({
    realCache: true,
    services: {
      "./transactions": {
        getTransactions: async () => {
          await blocked.wait();
          return serverRows; // the server's answer from before the create
        },
        createTransaction: async (params) => ({ ...params, user_id: "user-1", ...march }),
      },
    },
  });
  await db.transactions.bulkPut([
    { id: "kept", amount: 100, ...march },
    { id: "deleted-elsewhere", amount: 200, ...march },
  ]);

  // Warm cache: returns immediately and revalidates in the background.
  const shown = await offlineAware.getTransactionsOffline({ month: 3, year: 2026 });
  assert.deepEqual(shown.map((r) => r.id).sort(), ["deleted-elsewhere", "kept"]);
  await blocked.arrived;

  // While that fetch is in flight the user adds a transaction in the same month.
  const created = await offlineAware.createTransactionOffline({ ...newTransaction, transaction_date: "2026-03-12" });
  assert.equal(cache.getRevalidating(), true);

  blocked.release();
  await settle(() => !cache.getRevalidating());

  const ids = (await db.transactions.toArray()).map((r) => r.id).sort();
  // The new row is kept; the row the server no longer has is still reconciled away.
  assert.deepEqual(ids, [created.id, "kept"].sort());
});

test("OFF-10: a stale revalidation does not overwrite a row edited after it started", async () => {
  setOnline(true);
  const blocked = gate();
  const march = { transaction_date: "2026-03-10", status: "posted", deleted_at: null };
  const { offlineAware, db, cache } = await loadOfflineAware({
    realCache: true,
    services: {
      "./transactions": {
        getTransactions: async () => {
          await blocked.wait();
          return [{ id: "t1", amount: 100, ...march }];
        },
        updateTransaction: async (id, updates) => ({ id, ...march, ...updates }),
      },
    },
  });
  await db.transactions.put({ id: "t1", amount: 100, ...march });

  await offlineAware.getTransactionsOffline({ month: 3, year: 2026 });
  await blocked.arrived;
  await offlineAware.updateTransactionOffline("t1", { amount: 250 });
  blocked.release();
  await settle(() => !cache.getRevalidating());

  assert.equal((await db.transactions.get("t1")).amount, 250);
});

test("OFF-10: rows untouched since the fetch started are still reconciled", async () => {
  const { offlineDb } = await loadOfflineDb();
  const before = Date.now();
  assert.equal(offlineDb.writtenSince("transactions", "t1", before), false);
  await offlineDb.putOffline("transactions", { id: "t1", amount: 1 }, "create");
  assert.equal(offlineDb.writtenSince("transactions", "t1", before), true);
  assert.equal(offlineDb.writtenSince("transactions", "other", before), false);
  assert.equal(offlineDb.writtenSince("transactions", "t1", Date.now() + 1000), false);
  // A full pull rewrites the whole table.
  await offlineDb.cacheTable("accounts", [{ id: "a1" }]);
  assert.equal(offlineDb.writtenSince("accounts", "anything", before), true);
});

// ── OFF-12: queued rows are pushed at boot and failed pushes are retried ──

test("OFF-12: a sync requested at boot pushes rows queued in an earlier session", async () => {
  setOnline(true);
  const base = await loadLocalStore();
  // Left over from a previous session: nothing has gone offline/online since.
  await base.db.transactions.put({ id: "t1", user_id: "user-1", amount: 100, _offline: 1, _action: "update", _offlineAt: "earlier" });
  const { sync, calls } = await loadSync({
    modules: { offlineDb: { ...base.offlineDb }, syncQueue: { ...base.syncQueue } },
  });

  await sync.requestSync({ skipPull: true });

  assert.deepEqual(calls.map((c) => [c.method, c.value]), [["update", "t1"]]);
  assert.equal((await base.db.transactions.get("t1"))._offline, 0);
});

test("OFF-12: a partly failed push is retried after the back-off until the queue is empty", async () => {
  setOnline(true);
  const base = await loadLocalStore();
  const { offlineDb, db } = base;
  await offlineDb.putOffline("accounts", { id: "a1", user_id: "user-1", name: "Cash" }, "create");
  await offlineDb.putOffline("transactions", { id: "t1", user_id: "user-1", amount: 100 }, "create");

  let failures = 1;
  const { sync, calls } = await loadSync({
    modules: { offlineDb: { ...offlineDb }, syncQueue: { ...base.syncQueue } },
    respond: (call) =>
      call.table === "transactions" && failures-- > 0
        ? { error: { message: "temporarily unavailable" } }
        : undefined,
  });
  await sync.requestSync({ skipPull: true });

  assert.deepEqual(calls.map((c) => c.table), ["accounts", "transactions"]);
  assert.equal((await db.transactions.get("t1"))._offline, 1);
  assert.equal(sync.getSyncState().error, "temporarily unavailable");

  // Not retried immediately…
  mock.timers.tick(1500);
  await settle();
  assert.equal(calls.length, 2);
  // …but after the back-off, without any online / visibility event.
  mock.timers.tick(30_000);
  await settle(() => calls.length === 3);
  await sync.requestSync({ skipPull: true });

  assert.deepEqual(calls.map((c) => c.table), ["accounts", "transactions", "transactions"]);
  assert.equal((await db.transactions.get("t1"))._offline, 0);
  assert.equal(await offlineDb.getPendingSyncCount(), 0);
  assert.equal(sync.getSyncState().error, null);
});

test("OFF-12: a push in which nothing gets through is not retried on a timer", async () => {
  setOnline(true);
  const base = await loadLocalStore();
  await base.offlineDb.putOffline("accounts", { id: "a1", user_id: "user-1", name: "Cash" }, "create");
  const { sync, calls } = await loadSync({
    modules: { offlineDb: { ...base.offlineDb }, syncQueue: { ...base.syncQueue } },
    respond: () => ({ error: { message: "rejected" } }),
  });
  await sync.requestSync({ skipPull: true });

  mock.timers.tick(10 * 60_000);
  await settle();

  assert.equal(calls.length, 1);
  assert.equal((await base.db.accounts.get("a1"))._offline, 1);
});

// ── OFF-11: watermarks ──

// The real sync engine over the fake Dexie with a backend that serves pulls.
// `serve(table, since)` returns the rows for one pull request.
async function loadSyncForPull(serve) {
  const base = await loadLocalStore();
  const requests = [];
  const supabase = {
    from(table) {
      const request = { table, since: null };
      const query = {
        gt(column, value) {
          if (column === "updated_at") request.since = value;
          return query;
        },
        then(resolve, reject) {
          requests.push(request);
          return Promise.resolve()
            .then(() => serve(table, request.since))
            .then((data) => ({ data: data || [], error: null }))
            .then(resolve, reject);
        },
      };
      for (const method of ["select", "order", "range", "is", "eq"]) query[method] = () => query;
      return query;
    },
  };
  const sync = await load(sources.sync, {
    "./supabase": { supabase, getCurrentUser: async () => ({ id: "user-1" }) },
    "./offlineDb": { ...base.offlineDb },
    "../utils/syncQueue": { ...base.syncQueue },
    "./cache": { notifyTable: (name) => base.notified.push(name) },
    "../hooks/useDataSaver": { isDataSaver: () => false },
  });
  return { ...base, sync, requests };
}

const MINUTE = 60_000;
const iso = (ms) => new Date(ms).toISOString();

test("OFF-11: the watermark comes from before the fetch, capped by the data, minus a margin", async () => {
  const { sync } = await loadSync();
  const start = Date.parse("2026-03-01T12:00:00.000Z");

  // No rows: the local time the fetch started, minus the margin.
  assert.equal(sync.computeWatermark(start, []), iso(start - 5 * MINUTE));
  // Newest row older than the fetch start: the data caps it.
  assert.equal(
    sync.computeWatermark(start, [
      { updated_at: "2026-03-01T11:00:00+00:00" },
      { updated_at: "2026-03-01T11:30:00.123456+00:00" },
      { updated_at: null },
    ]),
    iso(Date.parse("2026-03-01T11:30:00.123Z") - 5 * MINUTE),
  );
  // A row stamped in the future (another device's fast clock) cannot push
  // the watermark past the start of the fetch.
  assert.equal(
    sync.computeWatermark(start, [{ updated_at: "2026-03-01T18:00:00+00:00" }]),
    iso(start - 5 * MINUTE),
  );
});

test("OFF-11: a stored watermark in the client's future is pulled back", async () => {
  const { sync } = await loadSync();
  const now = Date.parse("2026-03-01T12:00:00.000Z");
  assert.equal(sync.pullSince("2026-03-01T09:00:00.000Z", now), "2026-03-01T09:00:00.000Z");
  assert.equal(sync.pullSince("2026-03-01T15:00:00.000Z", now), iso(now - 5 * MINUTE));
  assert.equal(sync.pullSince("not a date", now), iso(now - 5 * MINUTE));
});

test("OFF-11: a full pull records a watermark from before the fetch, not the clock after it", async () => {
  setOnline(true);
  let before;
  const { sync, offlineDb, db } = await loadSyncForPull(async (table) => {
    if (table !== "accounts") return [];
    // A slow fetch: time passes on the client while the server pages.
    await settle();
    return [{ id: "a1", name: "Cash", is_active: true, updated_at: iso(before - 60 * MINUTE) }];
  });
  before = Date.now();
  await sync.pullAll({ full: true });

  assert.equal((await db.accounts.get("a1")).name, "Cash");
  // Capped by the newest row seen (an hour ago), minus the margin.
  assert.equal(await offlineDb.getTableLastSynced("accounts"), iso(before - 65 * MINUTE));
  // A table that returned nothing: before the fetch, minus the margin.
  const empty = Date.parse(await offlineDb.getTableLastSynced("categories"));
  assert.ok(empty <= before - 5 * MINUTE + 1000 && empty >= before - 5 * MINUTE - 1000);
});

test("OFF-11: an incremental pull re-reads the margin without rewriting or announcing known rows", async () => {
  setOnline(true);
  const t0 = Date.now() - 30 * MINUTE;
  const server = [
    { id: "a1", name: "Cash", is_active: true, updated_at: iso(t0) },
    { id: "a2", name: "Old", is_active: true, updated_at: iso(t0 - MINUTE) },
  ];
  const { sync, offlineDb, db, requests, notified } = await loadSyncForPull((table, since) =>
    table === "accounts" ? server.filter((r) => !since || r.updated_at > since) : [],
  );
  await sync.pullAll({ full: true });
  const watermark = await offlineDb.getTableLastSynced("accounts");
  assert.equal(watermark, iso(t0 - 5 * MINUTE));

  // Committed "late": stamped a little before the newest row already seen,
  // which a watermark equal to that newest row would skip forever.
  server.push({ id: "a3", name: "Late", is_active: true, updated_at: iso(t0 - 2 * MINUTE) });
  server[1] = { ...server[1], is_active: false, updated_at: iso(t0 - 3 * MINUTE) };
  notified.length = 0;
  requests.length = 0;
  await sync.pullAll();

  assert.equal(requests.find((r) => r.table === "accounts").since, watermark);
  assert.equal((await db.accounts.get("a3")).name, "Late");
  assert.equal(await db.accounts.get("a2"), undefined); // deactivated → pruned
  assert.deepEqual(notified.filter((n) => n === "accounts"), ["accounts"]);

  // Nothing new on the server: the overlap is re-read but nothing is
  // rewritten and nobody is notified.
  notified.length = 0;
  await sync.pullAll();
  assert.deepEqual(notified.filter((n) => n === "accounts"), []);
  assert.equal(await offlineDb.getTableLastSynced("accounts"), watermark);
});

// ── OFF-7: joins come from the live local tables ──

test("OFF-7: cache reads take category and account joins from the live tables", async () => {
  const { offlineAware, db } = await loadOfflineAware({ realCache: true });
  await seedLookups(db);
  const staleCategory = { id: "c-food", name: "Groceries (old)", color: "#000", type: "wants" };
  const staleAccount = { id: "a-check", name: "Old name", type: "checking" };
  await db.transactions.bulkPut([
    { id: "t1", category_id: "c-food", account_id: "a-check", amount: 100, transaction_date: "2026-03-10", status: "posted", deleted_at: null, categories: staleCategory, accounts: staleAccount },
    // Its category is not mirrored locally (e.g. deactivated): keep what we have.
    { id: "t2", category_id: "c-gone", account_id: "a-check", amount: 200, transaction_date: "2026-03-11", status: "posted", deleted_at: null, categories: { id: "c-gone", name: "Retired", color: "#999", type: "wants" }, accounts: staleAccount },
    // The stored join describes a different category than the row points at.
    { id: "t3", category_id: "c-missing", account_id: "a-check", amount: 300, transaction_date: "2026-03-12", status: "posted", deleted_at: null, categories: staleCategory },
  ]);
  await db.budget_items.put({ id: "i1", budget_plan_id: "p1", category_id: "c-food", planned_amount: 100, categories: staleCategory });

  const byId = (rows) => Object.fromEntries(rows.map((r) => [r.id, r]));
  const month = byId(await offlineAware.getTransactionsOffline({ month: 3, year: 2026 }));
  assert.deepEqual(month.t1.categories, { id: "c-food", name: "Food", color: "#111", type: "needs" });
  assert.deepEqual(month.t1.accounts, { id: "a-check", name: "Checking", type: "checking" });
  assert.equal(month.t2.categories.name, "Retired");
  assert.equal(month.t3.categories, null);

  const year = byId(await offlineAware.getTransactionsForYearOffline({ year: 2026 }));
  assert.equal(year.t1.categories.type, "needs");
  const ytd = byId(await offlineAware.getTransactionsYTDOffline({ year: 2026, throughMonth: 3 }));
  assert.equal(ytd.t1.categories.name, "Food");

  const [item] = await offlineAware.getBudgetItemsOffline("p1");
  assert.deepEqual(item.categories, { id: "c-food", name: "Food", color: "#111", type: "needs" });
});

test("OFF-7: an offline category rename or retype shows on its transactions", async () => {
  const { offlineAware, db } = await loadOfflineAware({ realCache: true });
  await seedLookups(db);
  await db.transactions.put({
    id: "t1", category_id: "c-food", account_id: "a-check", amount: 100, transaction_date: "2026-03-10",
    status: "posted", deleted_at: null, categories: { id: "c-food", name: "Food", color: "#111", type: "needs" },
  });

  await offlineAware.updateCategoryOffline("c-food", { name: "Dining", type: "wants" });

  const [row] = await offlineAware.getTransactionsOffline({ month: 3, year: 2026 });
  assert.deepEqual(row.categories, { id: "c-food", name: "Dining", color: "#111", type: "wants" });
});

test("OFF-7: moving a transaction offline replaces or drops its stored joins", async () => {
  const { offlineAware, db } = await loadOfflineAware();
  await seedLookups(db);
  await db.transactions.put({
    id: "t1", category_id: "c-food", account_id: "a-check", amount: 100, deleted_at: null,
    categories: { id: "c-food", name: "Food", color: "#111", type: "needs" },
    accounts: { id: "a-check", name: "Checking", type: "checking" },
  });

  const moved = await offlineAware.updateTransactionOffline("t1", { category_id: "c-rent", account_id: "a-save" });
  assert.equal(moved.categories.name, "Rent");
  assert.equal(moved.accounts.name, "Savings");
  assert.equal((await db.transactions.get("t1")).categories.name, "Rent");

  // Moved onto ids the local tables do not hold: no stale join is kept.
  const unknown = await offlineAware.updateTransactionOffline("t1", { category_id: "c-unknown", account_id: "a-unknown" });
  assert.equal(unknown.categories, null);
  assert.equal(unknown.accounts, null);
});

// ── OFF-9: rpc_cache only holds server answers, and queued writes clear it ──

test("OFF-9: a local fold used when the backend call fails is not stored as the server value", async () => {
  setOnline(true);
  let reachable = false;
  const { offlineAware, offlineDb, db } = await loadOfflineAware({
    realCache: true,
    services: {
      "./transactions": {
        getTransactionYears: async () => {
          if (!reachable) throw new TypeError("Failed to fetch");
          return [2019, 2020];
        },
      },
    },
  });
  await db.transactions.put({ id: "t1", transaction_date: "2024-05-01", deleted_at: null });

  // Backend unreachable: the fold over local rows keeps the screen populated…
  const folded = await offlineAware.getTransactionYearsOffline();
  assert.equal(folded[0], 2024);
  // …but it is not written to rpc_cache as if the server had said so.
  assert.equal(await offlineDb.readRpcCache("tx:years"), null);

  reachable = true;
  assert.deepEqual(await offlineAware.getTransactionYearsOffline(), [2019, 2020]);
  assert.deepEqual(await offlineDb.readRpcCache("tx:years"), [2019, 2020]);
});

test("OFF-9: an offline write clears rpc_cache so reads fold over local data", async () => {
  const { offlineAware, offlineDb, db } = await loadOfflineAware({ realCache: true });
  await db.transactions.put({ id: "t1", transaction_date: "2025-05-01", deleted_at: null });
  await offlineDb.writeRpcCache("tx:years", [2025, 2026, 2027]);
  await offlineDb.writeRpcCache("pva:m:2026-3", { categories: [] });

  // Offline with a stored server value: that value is served.
  assert.deepEqual(await offlineAware.getTransactionYearsOffline(), [2025, 2026, 2027]);

  await offlineAware.createTransactionOffline({ ...newTransaction, transaction_date: "2023-02-01" });

  assert.equal(await offlineDb.readRpcCache("tx:years"), null);
  assert.equal(await offlineDb.readRpcCache("pva:m:2026-3"), null);
  const years = await offlineAware.getTransactionYearsOffline();
  assert.equal(years[0], 2023); // includes the row created offline
  // Reading offline does not repopulate the cache with the fold.
  assert.equal(await offlineDb.readRpcCache("tx:years"), null);
});

// ── OFF-13: connectivity errors vs. real rejections ──

test("OFF-13: errors from not reaching the backend are classified as connectivity", async () => {
  setOnline(true);
  const { offlineAware } = await loadOfflineAware();
  const named = (name, message) => Object.assign(new Error(message), { name });
  const connectivity = [
    new TypeError("Failed to fetch"), // Chrome
    new TypeError("Load failed"), // Safari
    new TypeError("NetworkError when attempting to fetch resource."), // Firefox
    new TypeError("Network request failed"), // React Native / Capacitor
    // The PostgREST client's shape for a failed fetch.
    { message: "TypeError: Load failed", details: "", hint: "", code: "" },
    { message: "TimeoutError: signal timed out", code: "" },
    named("AbortError", "The operation was aborted."),
    named("TimeoutError", "The operation timed out."),
    new Error("Request timeout"),
    { message: "upstream", status: 0 },
    { message: "<html>502 Bad Gateway</html>", status: 502 },
    { message: "anything", status: 503 },
    { message: "anything", status: 504 },
    { message: "<html><h1>503 Service Unavailable</h1></html>" },
    { message: "JWT expired", code: "PGRST301" },
    { message: "Could not connect to the database", code: "PGRST002" },
    { message: "Unauthorized", status: 401 },
  ];
  for (const err of connectivity) {
    assert.equal(offlineAware.isConnectivityError(err), true, JSON.stringify(err.message));
  }
});

test("OFF-13: backend rejections are never classified as connectivity", async () => {
  setOnline(true);
  const { offlineAware } = await loadOfflineAware();
  const rejections = [
    { message: 'duplicate key value violates unique constraint "idx_network_timeout"', code: "23505" },
    { message: "Cannot create transactions on a closed account.", code: "23514" },
    { message: "new row violates row-level security policy", code: "42501" },
    { message: "insert or update violates foreign key constraint", code: "23503" },
    { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
    { message: "network policy forbids this", status: 403 },
    { message: "Bad Request", status: 400 },
    { message: "Conflict", status: 409 },
    { message: "Unprocessable", status: 422 },
    { message: "Internal Server Error", status: 500 },
    new Error("Not authenticated"),
    new Error('No available "Account Transfer" category found. Create or restore it in Categories.'),
    null,
  ];
  for (const err of rejections) {
    assert.equal(offlineAware.isConnectivityError(err), false, JSON.stringify(err?.message));
  }
  // …unless the browser itself says it is offline.
  setOnline(false);
  assert.equal(offlineAware.isConnectivityError(rejections[0]), true);
});

test("OFF-13: a Safari fetch failure queues the write; a constraint error surfaces", async () => {
  setOnline(true);
  let error = { message: "TypeError: Load failed", code: "" };
  const { offlineAware, db } = await loadOfflineAware({
    services: {
      "./transactions": {
        updateTransaction: async () => {
          throw error;
        },
      },
    },
  });
  await db.transactions.put({ id: "t1", amount: 100 });

  const queued = await offlineAware.updateTransactionOffline("t1", { amount: 200 });
  assert.equal(queued.amount, 200);
  assert.equal((await db.transactions.get("t1"))._action, "update");

  await db.transactions.put({ id: "t2", amount: 100 });
  error = { message: "value too long: network", code: "22001" };
  await assert.rejects(offlineAware.updateTransactionOffline("t2", { amount: 200 }), (err) => err.code === "22001");
  assert.equal((await db.transactions.get("t2"))._offline, undefined);
});

// ── OFF-14: transfer edits check the category is still available ──

test("OFF-14: a transfer cannot be moved to an archived category, online or offline", async () => {
  const { offlineAware, db } = await loadOfflineAware({
    services: { "./transactions": { updateAsymmetricTransfer: failIfCalled("updateAsymmetricTransfer") } },
  });
  await seedLookups(db);
  await db.categories.put({ id: "c-archived", name: "Old transfers", type: "transfer", is_active: true, is_archived: true });
  const legs = [
    { id: "out", transfer_group_id: "g1", account_id: "a-check", category_id: "c-xfer", amount: 5000, is_income: false, deleted_at: null },
    { id: "in", transfer_group_id: "g1", account_id: "a-save", category_id: "c-xfer", amount: 4900, is_income: true, deleted_at: null },
  ];
  await db.transactions.bulkPut(legs);
  const edit = {
    from_account_id: "a-check", to_account_id: "a-save", from_amount: 6000, to_amount: 5900,
    description: "Move", transaction_date: "2026-03-05",
  };

  for (const online of [false, true]) {
    setOnline(online);
    await assert.rejects(
      offlineAware.updateAsymmetricTransferOffline("out", { ...edit, category_id: "c-archived" }),
      /archived category/,
    );
    await assert.rejects(
      offlineAware.updateTransferOffline("out", { ...edit, amount: 6000, category_id: "c-archived" }),
      /archived category/,
    );
  }
  assert.deepEqual(await db.transactions.bulkGet(["out", "in"]), legs);

  // Keeping the category it already has is always allowed, even if archived since.
  setOnline(false);
  await db.categories.update("c-xfer", { is_archived: true });
  const [out] = await offlineAware.updateAsymmetricTransferOffline("out", { ...edit, category_id: "c-xfer" });
  assert.equal(out.amount, 6000);
});
