/**
 * Pure decision helpers for report / budget / split UI components.
 * Kept free of React and backend imports so they can be unit tested
 * (scripts/reports-ui.test.js).
 */
import { addMonths, format, subMonths, subYears } from 'date-fns';
import { isIncomeDebit, isSpendingCredit, toCents } from './helpers.js';

/**
 * Signed total for a category drill-down, matching the parent report rows
 * (see AnnualActualsTable): true income and ordinary spending add; a debit in
 * an income category and a credit (refund) in a spending category subtract.
 *
 * @param {Array<{ amount: number, is_income: boolean, categories?: { type?: string } }>} transactions
 * @returns {number} cents
 */
export function signedCategoryTotal(transactions) {
  let total = 0;
  for (const tx of transactions) {
    const amount = Math.abs(tx.amount);
    if (isIncomeDebit(tx) || isSpendingCredit(tx)) total -= amount;
    else total += amount;
  }
  return total;
}

/**
 * Work out one month of a budget CSV import without touching the backend.
 *
 * Rows are de-duplicated by resolved category (last row wins); `totalIncome`
 * is computed from that de-duplicated set so it always equals the sum of the
 * income items actually written. `staleCategoryIds` are categories that have
 * an existing item in the plan but are absent from the import — the caller
 * clears those only after (or together with) the upsert, never before, so a
 * failed import cannot leave the month empty.
 *
 * @param {{
 *   rows: Array<{ categoryName: string, monthAmounts: number[] }>,
 *   monthIndex: number,                       // 0-11
 *   categoriesByName: Record<string, { id: string, type: string }>, // lower-cased name → category
 *   existingItems?: Array<{ category_id: string }>,
 * }} input
 * @returns {{ items: Array<{ category_id: string, planned_amount: number }>, staleCategoryIds: string[], totalIncome: number }}
 */
export function planBudgetImportMonth({ rows, monthIndex, categoriesByName, existingItems = [] }) {
  const itemMap = new Map();
  const incomeIds = new Set();
  for (const row of rows) {
    const cat = categoriesByName[row.categoryName.toLowerCase()];
    if (!cat) continue;
    if (cat.type === 'income') incomeIds.add(cat.id);
    itemMap.set(cat.id, {
      category_id: cat.id,
      planned_amount: Math.max(0, toCents(row.monthAmounts[monthIndex])),
    });
  }
  const items = [...itemMap.values()];
  const totalIncome = items.reduce(
    (sum, item) => (incomeIds.has(item.category_id) ? sum + item.planned_amount : sum),
    0,
  );
  const staleCategoryIds = [...new Set(
    existingItems.map((item) => item.category_id).filter((id) => id && !itemMap.has(id)),
  )];
  return { items, staleCategoryIds, totalIncome };
}

/**
 * A custom split is valid only when both shares are whole, non-negative cents
 * that add up to the total (the DB enforces payer_share >= 0,
 * partner_share >= 0 and payer_share + partner_share = total_amount).
 *
 * @param {number} totalCents
 * @param {number} myShareCents
 * @param {number} partnerShareCents
 * @returns {boolean}
 */
export function isValidCustomSplit(totalCents, myShareCents, partnerShareCents) {
  return (
    Number.isInteger(myShareCents) &&
    Number.isInteger(partnerShareCents) &&
    myShareCents >= 0 &&
    partnerShareCents >= 0 &&
    myShareCents + partnerShareCents === totalCents
  );
}

/**
 * Date window for the cashflow chart. Month arithmetic uses date-fns, which
 * clamps to the last day of a shorter month (Jan 31 + 1 month = Feb 28/29)
 * instead of overflowing into the following month like Date#setMonth.
 *
 * @param {{
 *   todayStr: string,              // YYYY-MM-DD (local)
 *   pastMonths: number | null,     // null = "all" (10 years back)
 *   futureMonths: number,
 *   projectedToDate?: string | null, // YYYY-MM-DD; overrides futureMonths
 * }} input
 * @returns {{ startDate: string, endDate: string }}
 */
export function cashflowDateRange({ todayStr, pastMonths, futureMonths, projectedToDate = null }) {
  const today = new Date(`${todayStr}T00:00:00`);
  const start = pastMonths === null ? subYears(today, 10) : subMonths(today, pastMonths);
  const endDate = projectedToDate || format(addMonths(today, futureMonths), 'yyyy-MM-dd');
  return { startDate: format(start, 'yyyy-MM-dd'), endDate };
}

/**
 * Form-level replacement for the native `type="number" min max step="1"`
 * constraint: a whole number within [min, max].
 *
 * @param {string|number} value
 * @param {number} min
 * @param {number} max
 * @returns {boolean}
 */
export function isWholeNumberInRange(value, min, max) {
  if (value === '' || value === null || value === undefined) return false;
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max;
}

/**
 * Form-level replacement for the native `min="0.01" step="0.01"` constraint
 * on a dollar amount input. Returns an error message or null.
 *
 * @param {string|number} value dollars as typed
 * @returns {string|null}
 */
export function amountInputError(value) {
  const amount = typeof value === 'number' ? value : parseFloat(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(amount) || amount <= 0) return 'Required';
  if (toCents(amount) < 1) return 'Min 0.01';
  if (Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6) return 'Max 2 decimals';
  return null;
}

/**
 * A non-transfer line item may link a companion account, which must differ
 * from the item's own account (same rule as RecurringForm).
 *
 * @param {{ txType: string, accountId: string, linkedAccountId?: string }} child
 * @returns {string|null}
 */
export function linkedAccountError(child) {
  if (child.txType === 'transfer') return null;
  if (child.linkedAccountId && child.linkedAccountId === child.accountId) return 'Must differ';
  return null;
}

/**
 * Options for a year <select>: the base years plus the selected year when it
 * falls outside them, so the control never shows a different year from the
 * one it holds. Order of the base list (ascending or descending) is kept.
 *
 * @param {number[]} baseYears
 * @param {number|string} selectedYear
 * @returns {number[]}
 */
export function yearOptionsWithSelected(baseYears, selectedYear) {
  const selected = Number(selectedYear);
  if (!Number.isInteger(selected) || baseYears.includes(selected)) return baseYears;
  const descending = baseYears.length > 1 && baseYears[0] > baseYears[baseYears.length - 1];
  return [...baseYears, selected].sort((a, b) => (descending ? b - a : a - b));
}
