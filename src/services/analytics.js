import { supabase } from "./supabase";
import {
  isTrueIncome,
  isSpendingCredit,
  isIncomeDebit,
} from "../utils/helpers";

/**
 * Fetch monthly spending trend rows for the last `months` months ending at
 * `endMonth`/`endYear` (defaults to the current month).
 *
 * Backed by the `get_monthly_spending_trend` Postgres RPC (Phase 3) — the
 * server applies the same accounting rules the JS aggregator used to
 * (transfers excluded; spending-credits subtract from `spent`; income-debits
 * subtract from `income`) and returns one row per month already aggregated.
 *
 * @param {{ months?: number, endMonth?: number, endYear?: number }} opts
 * @returns {Promise<Array<{ key: string, label: string, year: number, month: number, spent: number, income: number, count: number }>>}
 *   `spent` and `income` are in cents.  Sorted oldest → newest.
 */
export async function getMonthlySpendingTrend({
  months = 6,
  endMonth,
  endYear,
} = {}) {
  const { data, error } = await supabase.rpc("get_monthly_spending_trend", {
    p_months: months,
    p_end_month: endMonth ?? null,
    p_end_year: endYear ?? null,
  });
  if (error) throw error;
  return (data || []).map((r) => ({
    key: r.key,
    // Server returns "Mon YYYY" (e.g. "Apr 2026"); existing UI used "Mon YYYY"
    // shape (computed in JS via SHORT_MONTHS) — keep parity.
    label: r.label,
    year: Number(r.year),
    month: Number(r.month),
    spent: Number(r.spent) || 0,
    income: Number(r.income) || 0,
    count: Number(r.tx_count) || 0,
  }));
}

/**
 * Fetch yearly spending trend rows for the last `years` calendar years
 * ending at `endMonth`/`endYear` (defaults to today).
 *
 * Backed by the `get_yearly_spending_trend` Postgres RPC (Phase 3).
 *
 * @param {{ years?: number, endMonth?: number, endYear?: number }} opts
 * @returns {Promise<Array<{ year: number, spent: number, income: number, count: number }>>}
 */
export async function getYearlySpendingTrend({
  years = 2,
  endMonth,
  endYear,
} = {}) {
  const { data, error } = await supabase.rpc("get_yearly_spending_trend", {
    p_years: years,
    p_end_month: endMonth ?? null,
    p_end_year: endYear ?? null,
  });
  if (error) throw error;
  return (data || []).map((r) => ({
    year: Number(r.year),
    spent: Number(r.spent) || 0,
    income: Number(r.income) || 0,
    count: Number(r.tx_count) || 0,
  }));
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
