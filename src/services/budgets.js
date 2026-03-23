import { supabase } from "./supabase";
import {
  isTrueIncome,
  isSpendingCredit,
  isIncomeDebit,
} from "../utils/helpers";

const CATEGORY_TYPE_ORDER = { income: 0, needs: 1, wants: 2, savings: 3 };

function sortCategories(a, b) {
  const ta = CATEGORY_TYPE_ORDER[a.categoryType] ?? 4;
  const tb = CATEGORY_TYPE_ORDER[b.categoryType] ?? 4;
  if (ta !== tb) return ta - tb;
  return (a.sortOrder ?? 999) - (b.sortOrder ?? 999);
}

/**
 * Get (or return null) the budget plan for a specific month/year.
 * @param {number} month 1-12
 * @param {number} year  e.g. 2026
 * @returns {Promise<Object|null>} budget plan row or null
 */
export async function getBudgetPlan(month, year) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

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
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

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
 * Joins budget_items (planned) with transactions (actual) per category.
 * Returns an array of { categoryId, categoryName, categoryColor, planned, actual }.
 * All amounts are in cents.
 *
 * @param {{ month: number, year: number }} params
 * @returns {Promise<Array<{
 *   categoryId: string,
 *   categoryName: string,
 *   categoryColor: string,
 *   planned: number,
 *   actual: number
 * }>>}
 */
export async function getPlanVsActual({ month, year }) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  // 1. Get the budget plan for this month (may be null)
  const { data: plan, error: planError } = await supabase
    .from("budget_plans")
    .select("id, total_income")
    .eq("user_id", user.id)
    .eq("month", month)
    .eq("year", year)
    .maybeSingle();
  if (planError) throw planError;

  // 2. Get budget items if a plan exists
  let budgetItems = [];
  if (plan) {
    const { data: items, error: itemsError } = await supabase
      .from("budget_items")
      .select(
        "category_id, planned_amount, categories(id, name, color, type, sort_order)",
      )
      .eq("budget_plan_id", plan.id);
    if (itemsError) throw itemsError;
    budgetItems = items || [];
  }

  // 3. Get transactions for the month (all — expenses and income)
  //    Paginate to avoid Supabase's 1000-row default limit.
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endMonth = month === 12 ? 1 : month + 1;
  const endYear = month === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  const PAGE_SIZE = 1000;
  let transactions = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error: txError } = await supabase
      .from("transactions")
      .select(
        "category_id, amount, is_income, categories(id, name, color, type, sort_order)",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .gte("transaction_date", startDate)
      .lt("transaction_date", endDate)
      .range(from, from + PAGE_SIZE - 1);
    if (txError) throw txError;
    transactions = transactions.concat(data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  // 4. Merge all non-transfer categories into a single map keyed by category_id
  const map = {};

  for (const item of budgetItems) {
    // Skip transfer categories only
    if (item.categories?.type === "transfer") continue;
    const catId = item.category_id;
    if (!map[catId]) {
      map[catId] = {
        categoryId: catId,
        categoryName: item.categories?.name || "Unknown",
        categoryColor: item.categories?.color || "#A8A29E",
        categoryType: item.categories?.type || "expense",
        sortOrder: item.categories?.sort_order ?? 999,
        planned: 0,
        actual: 0,
      };
    }
    map[catId].planned += item.planned_amount;
  }

  for (const tx of transactions || []) {
    // Skip transfer transactions — they don't affect budget totals
    if (tx.categories?.type === "transfer") continue;
    const catId = tx.category_id || "uncategorized";
    if (!map[catId]) {
      map[catId] = {
        categoryId: catId,
        categoryName: tx.categories?.name || "Uncategorized",
        categoryColor: tx.categories?.color || "#A8A29E",
        categoryType: tx.categories?.type || "expense",
        sortOrder: tx.categories?.sort_order ?? 999,
        planned: 0,
        actual: 0,
      };
    }
    if (isTrueIncome(tx)) {
      // Credit in an income category — adds to actual income
      map[catId].actual += Math.abs(tx.amount);
    } else if (isIncomeDebit(tx)) {
      // Debit in an income category — reduces actual income
      map[catId].actual -= Math.abs(tx.amount);
    } else if (isSpendingCredit(tx)) {
      // Credit in a spending category — reduces actual spending
      map[catId].actual -= Math.abs(tx.amount);
    } else {
      map[catId].actual += Math.abs(tx.amount);
    }
  }

  // 5. Derive income totals from the map for the summary cards
  const incomeCats = Object.values(map).filter(
    (c) => c.categoryType === "income",
  );
  const actualIncome = incomeCats.reduce((sum, c) => sum + c.actual, 0);

  const categories = Object.values(map).sort(sortCategories);
  return {
    categories,
    plannedIncome: plan?.total_income || 0,
    actualIncome,
  };
}

/**
 * Fetch plan-vs-actual data aggregated across Jan..throughMonth of the given year (YTD).
 * Sums planned amounts from all budget plans in that range and actual transactions YTD.
 *
 * @param {{ year: number, throughMonth: number }} params
 * @returns {Promise<Array<{
 *   categoryId: string,
 *   categoryName: string,
 *   categoryColor: string,
 *   planned: number,
 *   actual: number
 * }>>}
 */
export async function getPlanVsActualYTD({ year, throughMonth }) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

  // 1. Get all budget plans for months 1..throughMonth in this year
  const { data: plans, error: plansError } = await supabase
    .from("budget_plans")
    .select("id, total_income")
    .eq("user_id", user.id)
    .eq("year", year)
    .gte("month", 1)
    .lte("month", throughMonth);
  if (plansError) throw plansError;

  // 2. Get budget items for all those plans + sum planned income
  let budgetItems = [];
  const planIds = (plans || []).map((p) => p.id);
  const plannedIncome = (plans || []).reduce(
    (sum, p) => sum + (p.total_income || 0),
    0,
  );
  if (planIds.length > 0) {
    const { data: items, error: itemsError } = await supabase
      .from("budget_items")
      .select(
        "category_id, planned_amount, categories(id, name, color, type, sort_order)",
      )
      .in("budget_plan_id", planIds);
    if (itemsError) throw itemsError;
    budgetItems = items || [];
  }

  // 3. Get all transactions from Jan 1 through end of throughMonth
  //    Paginate to avoid Supabase's 1000-row default limit.
  const startDate = `${year}-01-01`;
  const endMonth = throughMonth === 12 ? 1 : throughMonth + 1;
  const endYear = throughMonth === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  const PAGE_SIZE = 1000;
  let transactions = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error: txError } = await supabase
      .from("transactions")
      .select(
        "category_id, amount, is_income, categories(id, name, color, type, sort_order)",
      )
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .gte("transaction_date", startDate)
      .lt("transaction_date", endDate)
      .range(from, from + PAGE_SIZE - 1);
    if (txError) throw txError;
    transactions = transactions.concat(data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  // 4. Merge all non-transfer categories into a single map keyed by category_id
  const map = {};

  for (const item of budgetItems) {
    // Skip transfer categories only
    if (item.categories?.type === "transfer") continue;
    const catId = item.category_id;
    if (!map[catId]) {
      map[catId] = {
        categoryId: catId,
        categoryName: item.categories?.name || "Unknown",
        categoryColor: item.categories?.color || "#A8A29E",
        categoryType: item.categories?.type || "expense",
        sortOrder: item.categories?.sort_order ?? 999,
        planned: 0,
        actual: 0,
      };
    }
    map[catId].planned += item.planned_amount;
  }

  for (const tx of transactions || []) {
    // Skip transfer transactions — they don't affect budget totals
    if (tx.categories?.type === "transfer") continue;
    const catId = tx.category_id || "uncategorized";
    if (!map[catId]) {
      map[catId] = {
        categoryId: catId,
        categoryName: tx.categories?.name || "Uncategorized",
        categoryColor: tx.categories?.color || "#A8A29E",
        categoryType: tx.categories?.type || "expense",
        sortOrder: tx.categories?.sort_order ?? 999,
        planned: 0,
        actual: 0,
      };
    }
    if (isTrueIncome(tx)) {
      // Credit in an income category — adds to actual income
      map[catId].actual += Math.abs(tx.amount);
    } else if (isIncomeDebit(tx)) {
      // Debit in an income category — reduces actual income
      map[catId].actual -= Math.abs(tx.amount);
    } else if (isSpendingCredit(tx)) {
      // Credit in a spending category — reduces actual spending
      map[catId].actual -= Math.abs(tx.amount);
    } else {
      map[catId].actual += Math.abs(tx.amount);
    }
  }

  // Derive actualIncome from the map for the summary cards
  const actualIncome = Object.values(map)
    .filter((c) => c.categoryType === "income")
    .reduce((sum, c) => sum + c.actual, 0);

  const categories = Object.values(map).sort(sortCategories);
  return {
    categories,
    plannedIncome,
    actualIncome,
  };
}

/**
 * Get all budget plans for an entire year (up to 12).
 * @param {number} year e.g. 2026
 * @returns {Promise<Array>} array of budget plan rows
 */
export async function getBudgetPlansForYear(year) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

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
