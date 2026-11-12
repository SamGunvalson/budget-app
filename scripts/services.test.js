import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import * as helpers from "../src/utils/helpers.js";

/**
 * Load a src/ module with its imports replaced by the given dependency map.
 * Any import not in the map fails the test.
 */
async function loadModule(relativePath, dependencies) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const synthetic = (specifier) => {
    const exports = dependencies[specifier];
    assert.ok(exports, `Unexpected import ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    });
  };
  const module = new SourceTextModule(source, {
    async importModuleDynamically(specifier) {
      const dynamic = synthetic(specifier);
      await dynamic.link(() => {});
      await dynamic.evaluate();
      return dynamic;
    },
  });
  await module.link(synthetic);
  await module.evaluate();
  return module.namespace;
}

const QUERY_METHODS = [
  "select", "insert", "update", "eq", "neq", "in", "is", "not", "gt", "gte", "lt", "lte",
  "order", "range", "limit", "single", "maybeSingle",
];

/**
 * A scripted Supabase stand-in. `respond(call)` answers each awaited query;
 * `rpc(name, args)` answers each RPC. Every call is recorded in `calls`.
 */
function fakeSupabase({ respond, rpc = () => ({ error: null }) }) {
  const calls = [];
  return {
    calls,
    supabase: {
      from(table) {
        const call = { table, steps: [] };
        calls.push(call);
        const query = {
          then(resolve, reject) {
            return Promise.resolve(respond(call)).then(resolve, reject);
          },
        };
        for (const method of QUERY_METHODS) {
          query[method] = (...args) => {
            call.steps.push({ method, args });
            return query;
          };
        }
        return query;
      },
      async rpc(name, args) {
        calls.push({ rpc: name, args });
        return rpc(name, args);
      },
    },
  };
}

const has = (call, method, ...args) =>
  call.steps.some((step) =>
    step.method === method && args.every((arg, i) => JSON.stringify(step.args[i]) === JSON.stringify(arg)));
const deletedIds = (calls) =>
  calls.filter((call) => call.rpc === "soft_delete_transaction").map((call) => call.args.txn_id);

// ── transactions.js (SVC-12) ──

/**
 * In-memory transactions table: "main" and "companion" share a transfer
 * group, "posted-leg"/"pending-leg" share another, "plain" is unpaired.
 */
async function loadTransactions({ failRpcFor = null, failCompanionLookup = false } = {}) {
  const rows = [
    { id: "main", transfer_group_id: "g1", status: "pending" },
    { id: "companion", transfer_group_id: "g1", status: "pending" },
    { id: "pending-leg", transfer_group_id: "g2", status: "pending" },
    { id: "posted-leg", transfer_group_id: "g2", status: "posted" },
    { id: "plain", transfer_group_id: null, status: "pending" },
  ];
  const arg = (call, method, column) =>
    call.steps.find((step) => step.method === method && step.args[0] === column)?.args[1];

  const fake = fakeSupabase({
    respond(call) {
      assert.equal(call.table, "transactions");
      const live = rows.filter((row) => !row.deleted_at);
      if (call.steps[0].method === "update") {
        const ids = arg(call, "in", "id") ?? [arg(call, "eq", "id")];
        const updated = live.filter((row) => ids.includes(row.id));
        for (const row of updated) Object.assign(row, call.steps[0].args[0]);
        if (has(call, "single")) {
          return updated.length === 1
            ? { data: { ...updated[0] }, error: null }
            : { data: null, error: { code: "PGRST116", message: "no rows" } };
        }
        return { data: updated.map((row) => ({ ...row })), error: null };
      }
      const groupId = arg(call, "eq", "transfer_group_id");
      if (groupId) {
        if (failCompanionLookup) return { data: null, error: { message: "lookup failed" } };
        const statuses = arg(call, "in", "status");
        return {
          data: live.filter((row) =>
            row.transfer_group_id === groupId &&
            row.id !== arg(call, "neq", "id") &&
            (!statuses || statuses.includes(row.status))),
          error: null,
        };
      }
      const row = live.find((r) => r.id === arg(call, "eq", "id")) || null;
      if (has(call, "single") && !row) return { data: null, error: { message: "no rows" } };
      return { data: row, error: null };
    },
    rpc(name, { txn_id }) {
      assert.equal(name, "soft_delete_transaction");
      if (txn_id === failRpcFor) return { error: { message: `cannot delete ${txn_id}` } };
      const row = rows.find((r) => r.id === txn_id);
      if (row) row.deleted_at = "now";
      return { error: null };
    },
  });
  const transactions = await loadModule("../src/services/transactions.js", {
    "./supabase": { supabase: fake.supabase, getCurrentUser: async () => ({ id: "owner" }) },
    "../utils/ids": { newId: () => "new-id" },
  });
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
  return { transactions, calls: fake.calls, byId };
}

test("SVC-12: deleteTransaction throws on a failed companion delete and keeps the original", async () => {
  const { transactions, calls, byId } = await loadTransactions({ failRpcFor: "companion" });
  await assert.rejects(transactions.deleteTransaction("main"), (err) => err.message === "cannot delete companion");
  assert.deepEqual(deletedIds(calls), ["companion"]);
  assert.equal(byId.main.deleted_at, undefined);
});

test("SVC-12: deleteTransaction throws when the companion lookup fails", async () => {
  const { transactions, calls } = await loadTransactions({ failCompanionLookup: true });
  await assert.rejects(transactions.deleteTransaction("main"), (err) => err.message === "lookup failed");
  assert.deepEqual(deletedIds(calls), []);
});

test("SVC-12: deleteTransaction still deletes both legs and returns both ids", async () => {
  const { transactions } = await loadTransactions();
  assert.deepEqual(await transactions.deleteTransaction("main"), ["main", "companion"]);
});

test("SVC-12: skipTransaction skips the unposted companion leg, companion first", async () => {
  const { transactions, calls, byId } = await loadTransactions();
  assert.equal(await transactions.skipTransaction("main"), "main");
  assert.deepEqual(deletedIds(calls), ["companion", "main"]);
  assert.ok(byId.main.deleted_at && byId.companion.deleted_at);
});

test("SVC-12: skipTransaction fails without deleting the requested leg if the companion fails", async () => {
  const { transactions, byId } = await loadTransactions({ failRpcFor: "companion" });
  await assert.rejects(transactions.skipTransaction("main"), (err) => err.message === "cannot delete companion");
  assert.equal(byId.main.deleted_at, undefined);
});

test("SVC-12: skipTransaction never removes a posted companion; unpaired rows are unchanged", async () => {
  const { transactions, calls } = await loadTransactions();
  await transactions.skipTransaction("pending-leg");
  await transactions.skipTransaction("plain");
  assert.deepEqual(deletedIds(calls), ["pending-leg", "plain"]);
});

test("SVC-12: confirmTransaction posts the companion leg and returns the requested row", async () => {
  const { transactions, byId } = await loadTransactions();
  const confirmed = await transactions.confirmTransaction("main");
  assert.equal(confirmed.id, "main");
  assert.equal(confirmed.status, "posted");
  assert.equal(byId.companion.status, "posted");
  assert.equal(byId.plain.status, "pending");
});

test("SVC-12: bulk confirm/skip return requested items first, then companions, without duplicates", async () => {
  const first = await loadTransactions();
  const confirmed = await first.transactions.bulkConfirmTransactions(["plain", "main"]);
  assert.deepEqual(confirmed.map((row) => row.id), ["plain", "main", "companion"]);
  assert.ok(confirmed.every((row) => row.status === "posted"));

  const second = await loadTransactions();
  assert.deepEqual(
    await second.transactions.bulkSkipTransactions(["main", "companion", "plain"]),
    ["main", "companion", "plain"],
  );
  assert.ok(second.byId.main.deleted_at && second.byId.companion.deleted_at && second.byId.plain.deleted_at);
});

// ── export.js (SVC-8, SVC-9) ──

/**
 * Load export.js against fixed table contents. Returns the sheet rows written
 * through the ExcelJS stand-in and the blobs handed to the browser download.
 */
async function loadExport(tables) {
  const sheetRows = [];
  const downloads = [];
  class Workbook {
    csv = { writeBuffer: async () => Buffer.from("") };
    addWorksheet() {
      return { addRow: (row) => sheetRows.push(row) };
    }
  }
  const fake = fakeSupabase({
    respond(call) {
      const rows = tables[call.table];
      assert.ok(rows, `Unexpected table ${call.table}`);
      return { data: rows, error: null };
    },
  });
  const originals = {
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const link = { click() {} };
  globalThis.document = {
    createElement: () => link,
    body: { appendChild() {}, removeChild() {} },
  };
  URL.createObjectURL = (blob) => {
    downloads.push(blob);
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  const restore = () => {
    if (originals.document) Object.defineProperty(globalThis, "document", originals.document);
    else delete globalThis.document;
    URL.createObjectURL = originals.createObjectURL;
    URL.revokeObjectURL = originals.revokeObjectURL;
  };
  const exporter = await loadModule("../src/services/export.js", {
    "./supabase": { supabase: fake.supabase, getCurrentUser: async () => ({ id: "owner" }) },
    "../utils/helpers": { ...helpers },
    exceljs: { default: { Workbook } },
  });
  return { exporter, calls: fake.calls, sheetRows, downloads, restore };
}

const tx = (overrides) => ({
  transaction_date: "2026-01-15", amount: 1000, is_income: false, status: "posted",
  category_id: "food", categories: { name: "Food", type: "needs" }, accounts: { name: "Checking" },
  description: "row", ...overrides,
});
const income = { category_id: "pay", categories: { name: "Pay", type: "income" } };

test("SVC-8: budget-history Actual nets refunds and income debits and counts only posted rows", async () => {
  const { exporter, sheetRows, restore } = await loadExport({
    budget_plans: [{ id: "plan", month: 1, year: 2026, total_income: 500000 }],
    budget_items: [
      { category_id: "food", planned_amount: 40000, categories: { name: "Food" } },
      { category_id: "pay", planned_amount: 500000, categories: { name: "Pay" } },
    ],
    transactions: [
      tx({ amount: 10000 }),
      tx({ amount: 2500, is_income: true }), // refund → reduces Food
      tx({ amount: 9999, status: "pending" }),
      tx({ amount: 8888, status: "projected" }),
      tx({ amount: 7777, transaction_date: "2999-01-01" }), // other month, future
      tx({ amount: 6666, category_id: "food", categories: { name: "Xfer", type: "transfer" } }),
      tx({ ...income, amount: 300000, is_income: true }),
      tx({ ...income, amount: 20000, is_income: false }), // income debit → reduces Pay
    ],
  });
  try {
    await exporter.exportBudgetCSV();
  } finally {
    restore();
  }
  const actual = Object.fromEntries(sheetRows.slice(1).map((row) => [row[2], row[4]]));
  assert.equal(actual.Food, "75.00");
  assert.equal(actual.Pay, "2800.00");
});

test("SVC-8: transactions CSV Type column does not label refunds or income debits as plain income/expense", async () => {
  const { exporter, sheetRows, restore } = await loadExport({
    transactions: [
      tx({}),
      tx({ is_income: true }),
      tx({ ...income, is_income: true }),
      tx({ ...income, is_income: false }),
      tx({ is_income: true, categories: { name: "Xfer", type: "transfer" } }),
    ],
  });
  try {
    await exporter.exportTransactionsCSV();
  } finally {
    restore();
  }
  assert.deepEqual(
    sheetRows.slice(1).map((row) => row[5]),
    ["Expense", "Refund", "Income", "Income Deduction", "Transfer"],
  );
});

test("SVC-9: full backup keeps inactive reference rows and includes partnerships and splits", async () => {
  const { exporter, calls, downloads, restore } = await loadExport({
    categories: [{ id: "food", is_active: false }],
    accounts: [{ id: "closed", is_active: false }],
    recurring_templates: [{ id: "old-template", is_active: false }],
    transactions: [tx({ account_id: "closed", recurring_template_id: "old-template" })],
    budget_plans: [],
    user_preferences: [],
    partnerships: [{ id: "partnership" }],
    split_expenses: [{ id: "split", partnership_id: "partnership" }],
  });
  let stats;
  try {
    stats = await exporter.exportFullBackupJSON();
  } finally {
    restore();
  }
  for (const table of ["categories", "accounts", "recurring_templates"]) {
    const call = calls.find((c) => c.table === table);
    assert.ok(!has(call, "eq", "is_active"), `${table} must not be filtered to is_active`);
  }
  const splitCall = calls.find((c) => c.table === "split_expenses");
  assert.ok(has(splitCall, "is", "deleted_at", null));

  const backup = JSON.parse(await downloads[0].text());
  assert.equal(backup.version, "1.2");
  assert.deepEqual(backup.data.accounts.map((row) => row.id), ["closed"]);
  assert.deepEqual(backup.data.categories.map((row) => row.id), ["food"]);
  assert.deepEqual(backup.data.recurring_templates.map((row) => row.id), ["old-template"]);
  assert.deepEqual(backup.data.partnerships, [{ id: "partnership" }]);
  assert.deepEqual(backup.data.split_expenses, [{ id: "split", partnership_id: "partnership" }]);
  assert.equal(stats.partnerships, 1);
  assert.equal(stats.splitExpenses, 1);
});
