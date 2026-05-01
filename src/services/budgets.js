import { supabase, getCurrentUser } from "./supabase";

/**
 * Get (or return null) the budget plan for a specific month/year.
 * @param {number} month 1-12
 * @param {number} year  e.g. 2026
 * @returns {Promise<Object|null>} budget plan row or null
 */
export async function getBudgetPlan(month, year) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("budget_plans")
    .select("*")
    .eq("user_id", user.id)
    .eq("month", month)
    .eq("year", year)
    .maybeSingle();

  if (error) throw error;
  return data; // null when no plan exists yet
}

/**
 * Create a new budget plan for a month/year.
 * @param {{ month: number, year: number, total_income: number }} plan
 * @returns {Promise<Object>} created plan
 */
export async function createBudgetPlan({ month, year, total_income }) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("budget_plans")
    .insert({
      user_id: user.id,
      month,
      year,
      total_income,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update an existing budget plan (e.g. total_income).
 * @param {string} planId UUID
 * @param {{ total_income?: number }} updates
 * @returns {Promise<Object>} updated plan
 */
export async function updateBudgetPlan(planId, { total_income }) {
  const payload = { updated_at: new Date().toISOString() };
  if (total_income !== undefined) payload.total_income = total_income;

  const { data, error } = await supabase
    .from("budget_plans")
    .update(payload)
    .eq("id", planId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Get all budget items (allocations) for a given plan, joined with category info.
 * @param {string} budgetPlanId UUID
 * @returns {Promise<Array>} budget_items rows with nested categories
 */
export async function getBudgetItems(budgetPlanId) {
  const { data, error } = await supabase
    .from("budget_items")
    .select("*, categories(id, name, color, type)")
    .eq("budget_plan_id", budgetPlanId);

  if (error) throw error;
  return data;
}

/**
 * Upsert (create or update) a single budget item.
 * Uses the unique (budget_plan_id, category_id) constraint.
 * @param {{ budget_plan_id: string, category_id: string, planned_amount: number }} item
 * @returns {Promise<Object>} upserted row
 */
export async function upsertBudgetItem({
  budget_plan_id,
  category_id,
  planned_amount,
}) {
  const { data, error } = await supabase
    .from("budget_items")
    .upsert(
      { budget_plan_id, category_id, planned_amount },
      { onConflict: "budget_plan_id,category_id" },
    )
    .select("*, categories(id, name, color, type)")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Fetch plan-vs-actual data for a given month/year.
 *
 * Backed by the `get_plan_vs_actual` Postgres RPC (Phase 3) — one round-trip
 * that joins budget_items ↔ transactions per category and applies the same
 * accounting rules as the previous client-side merge:
 *   • transfer-type categories are excluded
 *   • spending-credits (is_income in needs/wants/savings) reduce actual
 *   • income-debits (NOT is_income in income cat) reduce actual income
 * Categories are returned already sorted income → needs → wants → savings,
 * then by sort_order, then name.  All amounts in cents.
 *
 * @param {{ month: number, year: number }} params
 * @returns {Promise<{ categories: Array, plannedIncome: number, actualIncome: number }>}
 */
export async function getPlanVsActual({ month, year }) {
  const { data, error } = await supabase.rpc("get_plan_vs_actual", {
    p_month: month,
    p_year: year,
  });
  if (error) throw error;
  return coercePlanVsActualPayload(data);
}

function coercePlanVsActualPayload(payload) {
  if (!payload) return { categories: [], plannedIncome: 0, actualIncome: 0 };
  return {
    categories: (payload.categories || []).map((c) => ({
      ...c,
      planned: Number(c.planned) || 0,
      actual: Number(c.actual) || 0,
      sortOrder: Number(c.sortOrder ?? 999),
    })),
    plannedIncome: Number(payload.plannedIncome) || 0,
    actualIncome: Number(payload.actualIncome) || 0,
  };
}

/**
 * Fetch plan-vs-actual data aggregated across Jan..throughMonth of the given year (YTD).
 *
 * Backed by the `get_plan_vs_actual_ytd` Postgres RPC (Phase 3).  Same shape
 * and accounting rules as `getPlanVsActual`, just summed across months 1..N.
 *
 * @param {{ year: number, throughMonth: number }} params
 * @returns {Promise<{ categories: Array, plannedIncome: number, actualIncome: number }>}
 */
export async function getPlanVsActualYTD({ year, throughMonth }) {
  const { data, error } = await supabase.rpc("get_plan_vs_actual_ytd", {
    p_year: year,
    p_through_month: throughMonth,
  });
  if (error) throw error;
  return coercePlanVsActualPayload(data);
}

/**
 * Get all budget plans for an entire year (up to 12).
 * @param {number} year e.g. 2026
 * @returns {Promise<Array>} array of budget plan rows
 */
export async function getBudgetPlansForYear(year) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const { data, error } = await supabase
    .from("budget_plans")
    .select("*")
    .eq("user_id", user.id)
    .eq("year", year)
    .order("month");

  if (error) throw error;
  return data || [];
}

/**
 * Bulk-upsert many budget items at once.
 * @param {Array<{ budget_plan_id: string, category_id: string, planned_amount: number }>} items
 * @returns {Promise<Array>} upserted rows
 */
export async function upsertBudgetItems(items) {
  if (!items.length) return [];

  const { data, error } = await supabase
    .from("budget_items")
    .upsert(items, { onConflict: "budget_plan_id,category_id" })
    .select("*, categories(id, name, color, type)");

  if (error) throw error;
  return data;
}

/**
 * Delete all budget items for a given plan (used before replacing via import).
 * @param {string} planId UUID
 * @returns {Promise<void>}
 */
export async function deleteBudgetItemsForPlan(planId) {
  const { error } = await supabase
    .from("budget_items")
    .delete()
    .eq("budget_plan_id", planId);

  if (error) throw error;
}

/**
 * Copy all budget plans and items from sourceYear into targetYear.
 *
 * @param {number} sourceYear  e.g. 2025
 * @param {number} targetYear  e.g. 2026
 * @param {{ overwrite?: boolean }} options
 *   overwrite – if true, replace any existing target-year months;
 *               if false (default), skip months that already have a plan.
 * @returns {Promise<{ monthsCopied: number, monthsSkipped: number }>}
 */
export async function copyBudgetFromYear(
  sourceYear,
  targetYear,
  { overwrite = false } = {},
) {
  // 1. Fetch source plans + their items
  const sourcePlans = await getBudgetPlansForYear(sourceYear);
  if (!sourcePlans.length) return { monthsCopied: 0, monthsSkipped: 0 };

  const sourceData = await Promise.all(
    sourcePlans.map(async (p) => {
      const items = await getBudgetItems(p.id);
      return { plan: p, items };
    }),
  );

  // 2. Fetch existing target-year plans for conflict detection
  const targetPlans = await getBudgetPlansForYear(targetYear);
  const targetPlanByMonth = {};
  targetPlans.forEach((p) => {
    targetPlanByMonth[p.month] = p;
  });

  let monthsCopied = 0;
  let monthsSkipped = 0;

  for (const { plan, items } of sourceData) {
    const { month } = plan;

    // Skip occupied months unless overwrite is requested
    if (!overwrite && targetPlanByMonth[month]) {
      monthsSkipped++;
      continue;
    }

    let targetPlan = targetPlanByMonth[month];

    if (!targetPlan) {
      targetPlan = await createBudgetPlan({
        month,
        year: targetYear,
        total_income: plan.total_income,
      });
    } else {
      // Overwrite: clear existing items and sync income
      await deleteBudgetItemsForPlan(targetPlan.id);
      await updateBudgetPlan(targetPlan.id, {
        total_income: plan.total_income,
      });
    }

    if (items.length > 0) {
      const newItems = items.map((item) => ({
        budget_plan_id: targetPlan.id,
        category_id: item.category_id,
        planned_amount: item.planned_amount,
      }));
      await upsertBudgetItems(newItems);
    }

    monthsCopied++;
  }

  return { monthsCopied, monthsSkipped };
}
