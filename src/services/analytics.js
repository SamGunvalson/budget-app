import { supabase } from "./supabase";
import {
  isTrueIncome,
  isSpendingCredit,
  isIncomeDebit,
} from "../utils/helpers";

/**
 * Fetch spending transactions for the last N months, grouped by month.
 * Returns raw transaction rows so the caller can aggregate as needed.
 *
 * @param {{ months?: number, endMonth?: number, endYear?: number }} opts
 *   `endMonth` / `endYear` (1-indexed month) anchor the end of the window.
 *   When omitted the window ends at today.
 * @returns {Promise<Array>} transactions with joined category data
 */
export async function getTrendTransactions({
  months = 6,
  endMonth,
  endYear,
} = {}) {
  // Anchor: last day of endMonth/endYear, or today
  const anchorEnd =
    endMonth != null && endYear != null
      ? new Date(endYear, endMonth, 0) // day-0 of next month = last day of endMonth
      : new Date();

  const startDate = new Date(
    anchorEnd.getFullYear(),
    anchorEnd.getMonth() - months + 1,
    1,
  );
  const startStr = startDate.toISOString().slice(0, 10); // YYYY-MM-DD
  const endStr = anchorEnd.toISOString().slice(0, 10);

  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "amount, transaction_date, is_income, categories(id, name, color, type)",
      )
      .is("deleted_at", null)
      .gte("transaction_date", startStr)
      .lte("transaction_date", endStr)
      .order("transaction_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

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

/**
 * Fetch spending transactions for the last N full calendar years
 * (current year + previous years).
 *
 * @param {{ years?: number, endMonth?: number, endYear?: number }} opts
 *   `endMonth` / `endYear` (1-indexed month) anchor the end of the window.
 *   When omitted the window ends at today.
 * @returns {Promise<Array>} transactions with joined category data
 */
export async function getYearlyTrendTransactions({
  years = 2,
  endMonth,
  endYear,
} = {}) {
  // Anchor: last day of endMonth/endYear, or today
  const anchorEnd =
    endMonth != null && endYear != null
      ? new Date(endYear, endMonth, 0) // day-0 of next month = last day of endMonth
      : new Date();

  const startYear = anchorEnd.getFullYear() - years + 1;
  const startStr = `${startYear}-01-01`;
  const endStr = anchorEnd.toISOString().slice(0, 10);

  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("transactions")
      .select(
        "amount, transaction_date, is_income, categories(id, name, color, type)",
      )
      .is("deleted_at", null)
      .gte("transaction_date", startStr)
      .lte("transaction_date", endStr)
      .order("transaction_date", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

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

/**
 * Aggregate raw transactions into monthly spending totals.
 *
 * @param {Array} transactions – rows from Supabase
 * @param {{ expensesOnly?: boolean }} opts
 * @returns {Array<{ key: string, label: string, year: number, month: number, spent: number, income: number, count: number }>}
 *   Sorted oldest → newest. `spent` and `income` are in cents.
 */
export function aggregateByMonth(transactions) {
  const map = {}; // "2026-02" → { spent, income, count }

  for (const t of transactions) {
    // Skip transfer transactions — they don't affect income or spending totals
    if (t.categories?.type === "transfer") continue;

    const d = new Date(t.transaction_date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;

    if (!map[key]) {
      map[key] = { key, year: y, month: m, spent: 0, income: 0, count: 0 };
    }

    if (isTrueIncome(t)) {
      map[key].income += Math.abs(t.amount);
    } else if (isIncomeDebit(t)) {
      // Debit in an income category — reduce income total
      map[key].income -= Math.abs(t.amount);
    } else if (isSpendingCredit(t)) {
      // Credit in a spending category — reduce spending total
      map[key].spent -= Math.abs(t.amount);
      map[key].count += 1;
    } else {
      map[key].spent += Math.abs(t.amount);
      map[key].count += 1;
    }
  }

  const SHORT_MONTHS = [
    "",
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  return Object.values(map)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((m) => ({
      ...m,
      label: `${SHORT_MONTHS[m.month]} ${m.year}`,
    }));
}

/**
 * Aggregate raw transactions into yearly spending totals.
 *
 * @param {Array} transactions
 * @returns {Array<{ year: number, spent: number, income: number, count: number }>}
 */
export function aggregateByYear(transactions) {
  const map = {};

  for (const t of transactions) {
    // Skip transfer transactions — they don't affect income or spending totals
    if (t.categories?.type === "transfer") continue;

    const d = new Date(t.transaction_date);
    const y = d.getUTCFullYear();

    if (!map[y]) {
      map[y] = { year: y, spent: 0, income: 0, count: 0 };
    }

    if (isTrueIncome(t)) {
      map[y].income += Math.abs(t.amount);
    } else if (isIncomeDebit(t)) {
      // Debit in an income category — reduce income total
      map[y].income -= Math.abs(t.amount);
    } else if (isSpendingCredit(t)) {
      // Credit in a spending category — reduce spending total
      map[y].spent -= Math.abs(t.amount);
      map[y].count += 1;
    } else {
      map[y].spent += Math.abs(t.amount);
      map[y].count += 1;
    }
  }

  return Object.values(map).sort((a, b) => a.year - b.year);
}

/**
 * Compute summary statistics from monthly aggregated data.
 *
 * @param {Array<{ label: string, spent: number }>} monthlyData
 * @returns {{ average: number, highest: { label: string, spent: number }, lowest: { label: string, spent: number }, total: number, monthCount: number }}
 *   All monetary values in cents.
 */
export function computeTrendSummary(monthlyData) {
  if (!monthlyData || monthlyData.length === 0) {
    return { average: 0, highest: null, lowest: null, total: 0, monthCount: 0 };
  }

  let total = 0;
  let highest = monthlyData[0];
  let lowest = monthlyData[0];

  for (const m of monthlyData) {
    total += m.spent;
    if (m.spent > highest.spent) highest = m;
    if (m.spent < lowest.spent) lowest = m;
  }

  return {
    average: Math.round(total / monthlyData.length),
    highest,
    lowest,
    total,
    monthCount: monthlyData.length,
  };
}
