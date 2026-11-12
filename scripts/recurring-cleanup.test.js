import { randomUUID } from 'node:crypto';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { addDays, format, isAfter, startOfDay } from "date-fns";

const source = readFileSync(new URL("../src/services/recurring.js", import.meta.url), "utf8");

async function loadRecurring({ queries = [], rpcs = [] } = {}) {
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
      for (const method of ["select", "update", "eq", "in", "is", "not", "gt", "order", "single", "maybeSingle"]) {
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
