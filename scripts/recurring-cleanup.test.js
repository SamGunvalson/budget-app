import { randomUUID } from 'node:crypto';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { addDays, format, isAfter, startOfDay } from "date-fns";

const source = readFileSync(new URL("../src/services/recurring.js", import.meta.url), "utf8");

async function loadRecurring({ queries = [], rpcs = [], overrides = {} } = {}) {
  const calls = [];
  const supabase = {
    from(table) {
      const call = { table, steps: [] };
      calls.push(call);
      const query = {
        then(resolve, reject) {
          assert.ok(queries.length, `Unexpected query on ${table}`);
          return Promise.resolve(queries.shift()).then(resolve, reject);
        },
      };
      for (const method of ["select", "insert", "update", "eq", "in", "is", "not", "gt", "lte", "limit", "ilike", "order", "single", "maybeSingle"]) {
        query[method] = (...args) => {
          call.steps.push({ method, args });
          return query;
        };
      }
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      assert.ok(rpcs.length, `Unexpected RPC ${name}`);
      return rpcs.shift();
    },
  };
  const dependencies = {
    "./supabase": { supabase, getCurrentUser: async () => ({ id: "owner" }) },
    "../utils/ids": { newId: () => randomUUID() },
    "date-fns": { addDays, format, isAfter, startOfDay },
    "../utils/recurringCalculations": {
      getPendingOccurrences: () => [],
      getOccurrencesInRange: (template) => template.occurrences || [],
    },
    "./partnerships": { getPartnership: () => null, getPartnerId: () => null },
    "./splitExpenses": { computeShares: () => null, createSplitExpense: () => null },
    ...overrides,
  };
  const module = new SourceTextModule(source);
  await module.link((specifier) => {
    const exports = dependencies[specifier];
    assert.ok(exports, `Unexpected import ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    });
  });
  await module.evaluate();
  return { recurring: module.namespace, calls };
}

test("standalone cleanup uses the scoped RPC and local today's cutoff", async () => {
  const { recurring, calls } = await loadRecurring({ rpcs: [{ data: 2, error: null }] });
  await recurring.clearProjectedTransactionsForTemplate("template");
  assert.deepEqual(calls, [{
    name: "soft_delete_recurring_projections",
    args: {
      p_template_ids: ["template"],
      p_transaction_ids: null,
      p_from_date: format(startOfDay(new Date()), "yyyy-MM-dd"),
    },
  }]);
});

test("family refresh clears inactive children, resets markers, and then regenerates", async () => {
  const { recurring, calls } = await loadRecurring({
    queries: [
      { data: { id: "child", group_id: "parent" }, error: null },
      { data: [{ id: "child" }, { id: "inactive-child" }], error: null },
      { error: null },
      { data: [], error: null },
      { data: [], error: null },
    ],
    rpcs: [{ data: 3, error: null }],
  });
  assert.deepEqual(await recurring.refreshRecurringTemplateFamily("child"), {
    cleaned: 3, generated: 0,
  });
  assert.deepEqual(calls[2].args.p_template_ids, ["parent", "child", "inactive-child"]);
  assert.equal(calls[3].table, "recurring_templates");
  assert.deepEqual(calls[3].steps[0], {
    method: "update", args: [{ projected_through: null }],
  });
  assert.equal(calls[4].table, "recurring_templates");
  assert.equal(calls[5].table, "transactions");
  assert.ok(!calls[1].steps.some((step) => step.method === "eq" && step.args[0] === "is_active"));
});

test("failed cleanup propagates the database error without resetting or regenerating", async () => {
  const error = { code: "42501", message: "denied" };
  const { recurring, calls } = await loadRecurring({
    queries: [{ data: null, error: null }],
    rpcs: [{ error }],
  });
  await assert.rejects(recurring.refreshRecurringTemplateFamily("missing"), (err) => err === error);
  assert.equal(calls.length, 2);
});

test("orphan cleanup deletes only invalid occurrence IDs with a strictly future cutoff", async () => {
  const today = new Date("2026-11-03T00:00:00");
  const { recurring, calls } = await loadRecurring({
    queries: [
      { data: [{
        id: "template", occurrences: [addDays(today, 1)],
      }], error: null },
      { data: [
        { id: "valid", recurring_template_id: "template", transaction_date: "2026-11-10", recurring_occurrence_date: "2026-11-04" },
        { id: "orphan", recurring_template_id: "template", transaction_date: "2026-11-05", recurring_occurrence_date: null },
      ], error: null },
    ],
    rpcs: [{ data: 0, error: null }],
  });
  assert.deepEqual(await recurring.cleanupOrphanedProjections({ today }), { cleaned: 0 });
  assert.deepEqual(calls[2], {
    name: "soft_delete_recurring_projections",
    args: {
      p_template_ids: null,
      p_transaction_ids: ["orphan"],
      p_from_date: "2026-11-04",
    },
  });
});

test("orphan cleanup does not issue an unscoped RPC when nothing needs deleting", async () => {
  const { recurring, calls } = await loadRecurring({
    queries: [{ data: [], error: null }, { data: [], error: null }],
  });
  assert.deepEqual(await recurring.cleanupOrphanedProjections(), { cleaned: 0 });
  assert.equal(calls.length, 2);
});

test("recurring service never directly soft-deletes transactions", () => {
  assert.doesNotMatch(source, /deleted_at:\s/);
});

// SVC-5: a split template with a linked account confirms two legs that share
// the template id; only the main leg gets a split, at the transaction's amount.
test("auto-confirm creates one split for the main leg using the transaction amount", async () => {
  const main = {
    id: "main", recurring_template_id: "tpl", transaction_date: "2026-11-01", description: "Rent",
    amount: 7500, category_id: "rent", transfer_group_id: "group", categories: { type: "needs" },
  };
  const companion = {
    ...main, id: "companion", category_id: "xfer", categories: { type: "transfer" },
  };
  const shareCalls = [];
  const splitCalls = [];
  const { recurring, calls } = await loadRecurring({
    queries: [
      { data: [main, companion], error: null },
      { data: [{
        id: "tpl", auto_confirm: true, is_transfer: false, is_split: true, split_method: "equal",
        split_payer: "me", split_partner_share_pct: null, amount: -5000, description: "Rent",
        category_id: "rent",
      }], error: null },
      { data: [main, companion], error: null },
    ],
    overrides: {
      "./partnerships": { getPartnership: async () => ({ id: "partnership" }), getPartnerId: () => "partner" },
      "./splitExpenses": {
        computeShares: (...args) => {
          shareCalls.push(args);
          return { payerShare: 3750, partnerShare: 3750, paidByUserId: "owner" };
        },
        createSplitExpense: async (args) => { splitCalls.push(args); },
      },
    },
  });
  assert.equal(await recurring.autoConfirmDueTransactions(new Date("2026-11-03T00:00:00")), 2);
  assert.equal(splitCalls.length, 1);
  assert.equal(splitCalls[0].transactionId, "main");
  assert.equal(splitCalls[0].totalAmount, 7500);
  assert.equal(shareCalls[0][0], 7500);
  const confirmSelect = calls[2].steps.find((step) => step.method === "select").args[0];
  for (const column of ["amount", "category_id", "transfer_group_id", "categories(type)"]) {
    assert.ok(confirmSelect.includes(column), `confirm select is missing ${column}`);
  }
});

// SVC-6: callers arriving during a run share one follow-up run that starts
// after the in-flight run finishes, instead of receiving its stale result.
test("generation requested mid-run queues exactly one follow-up run", async () => {
  let releaseFirstRun;
  const firstTemplates = new Promise((resolve) => { releaseFirstRun = resolve; });
  const today = new Date("2026-11-03T00:00:00");
  const queries = [firstTemplates, { data: [], error: null }];
  const { recurring, calls } = await loadRecurring({ queries });

  const first = recurring.generateProjectedTransactions({ today });
  const second = recurring.generateProjectedTransactions({ today });
  const third = recurring.generateProjectedTransactions({ today });

  // The edit lands after the first run took its (empty) template snapshot.
  queries.push(
    { data: [{
      id: "tpl", description: "Rent", amount: -5000, is_income: false,
      account_id: "account", category_id: "rent", occurrences: [addDays(today, 1)],
    }], error: null },
    { data: [], error: null },
    { data: [], error: null },
    { data: { id: "created" }, error: null },
    { error: null },
  );
  releaseFirstRun({ data: [], error: null });

  assert.equal((await first).generated, 0);
  const [secondResult, thirdResult] = await Promise.all([second, third]);
  assert.equal(secondResult.generated, 1);
  assert.equal(thirdResult, secondResult);
  const templateReads = calls.filter((call) =>
    call.table === "recurring_templates" && call.steps[0].method === "select");
  assert.equal(templateReads.length, 2);
  assert.equal(queries.length, 0);

  // The guard resets: a later call starts a fresh run.
  queries.push({ data: [], error: null }, { data: [], error: null });
  assert.equal((await recurring.generateProjectedTransactions({ today })).generated, 0);
});
