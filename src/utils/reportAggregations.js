/**
 * Pure aggregation helpers shared by the Reports tabs (Overview, Categories,
 * Trends, Annual). Kept free of React and backend imports so they can be unit
 * tested (scripts/report-aggregations.test.js).
 *
 * Every function expects transactions that are already filtered for the
 * report's settled/upcoming rule (`isSettledTransaction`). Transfers are always
 * skipped. Amounts are integer cents; signs follow the classification helpers
 * (see `signedAmount`), never the stored sign.
 */
import { isIncomeDebit, isSpendingCredit } from './helpers.js';

/** Spending category types, in display order. */
export const SPENDING_TYPES = ['needs', 'wants', 'savings'];

/** `YYYY-MM` key for a year and 1-based month. */
export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** `YYYY-MM` key of a `YYYY-MM-DD` transaction date (no Date parsing). */
export function txMonthKey(tx) {
  return tx.transaction_date.slice(0, 7);
}

/** Move a 1-based month by `delta` months. */
export function shiftMonth(year, month, delta) {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/**
 * `count` consecutive month keys ending at (endYear, endMonth), oldest first.
 * @returns {string[]}
 */
export function monthRange(endYear, endMonth, count) {
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const { year, month } = shiftMonth(endYear, endMonth, -i);
    keys.push(monthKey(year, month));
  }
  return keys;
}

/**
 * A transaction's signed contribution to its category total, or null for
 * transfers. True income and ordinary spending add; a debit in an income
 * category and a credit (refund) in a spending category subtract. Matches
 * `signedCategoryTotal` in reportRules.js and AnnualActualsTable.
 */
export function signedAmount(tx) {
  if (tx.categories?.type === 'transfer') return null;
  const amount = Math.abs(tx.amount);
  return isIncomeDebit(tx) || isSpendingCredit(tx) ? -amount : amount;
}

/** The category type a transaction reports under ('other' when unknown). */
function txType(tx) {
  return tx.categories?.type ?? 'other';
}

function txCategoryId(tx) {
  return tx.category_id || 'uncategorized';
}

/**
 * Transactions belonging to one category's drill-down (transfers excluded).
 * A category's type fixes whether it reports as income or spending, so the
 * category id alone is enough.
 */
export function drillDownTransactions(transactions, categoryId) {
  return transactions.filter(
    (tx) => tx.categories?.type !== 'transfer' && txCategoryId(tx) === categoryId,
  );
}

/**
 * Category × month totals.
 *
 * @returns {{
 *   byCategory: Record<string, Record<string, number>>,  // categoryId → monthKey → cents
 *   byType: Record<string, Record<string, number>>,      // type → monthKey → cents
 *   meta: Record<string, { name: string, color: string | null, type: string }>,
 * }}
 */
export function categoryMonthMatrix(transactions) {
  const byCategory = {};
  const byType = {};
  const meta = {};

  for (const tx of transactions) {
    const value = signedAmount(tx);
    if (value === null) continue;
    const id = txCategoryId(tx);
    const type = txType(tx);
    const key = txMonthKey(tx);

    if (!meta[id]) {
      meta[id] = {
        name: tx.categories?.name || 'Uncategorized',
        color: tx.categories?.color ?? null,
        type,
      };
    }
    byCategory[id] ??= {};
    byCategory[id][key] = (byCategory[id][key] ?? 0) + value;
    byType[type] ??= {};
    byType[type][key] = (byType[type][key] ?? 0) + value;
  }

  return { byCategory, byType, meta };
}

/** Sum a `monthKey → cents` row over `keys` (missing months count as 0). */
export function sumMonths(row, keys) {
  if (!row) return 0;
  return keys.reduce((sum, key) => sum + (row[key] ?? 0), 0);
}

/** Average of a `monthKey → cents` row over `keys`, zero months included. */
export function averageMonths(row, keys) {
  if (keys.length === 0) return 0;
  return Math.round(sumMonths(row, keys) / keys.length);
}

/**
 * Savings rate = (income − needs − wants) ÷ income. Money left over counts as
 * saved. Null when there is no positive income.
 */
export function savingsRate({ income, needs = 0, wants = 0 }) {
  if (!(income > 0)) return null;
  return (income - needs - wants) / income;
}

/**
 * Income and spending-type totals per month, with the savings rate.
 * @returns {Array<{ key: string, income: number, needs: number, wants: number,
 *   savings: number, savingsRate: number | null }>}
 */
export function typeMixByMonth(matrix, keys) {
  return keys.map((key) => {
    const row = {
      key,
      income: matrix.byType.income?.[key] ?? 0,
      needs: matrix.byType.needs?.[key] ?? 0,
      wants: matrix.byType.wants?.[key] ?? 0,
      savings: matrix.byType.savings?.[key] ?? 0,
    };
    return { ...row, savingsRate: savingsRate(row) };
  });
}

/**
 * Spending split into fixed (generated from a recurring template) and
 * flexible (everything else), per month. Income and transfers are skipped.
 * @returns {Array<{ key: string, fixed: number, flexible: number }>}
 */
export function fixedFlexibleByMonth(transactions, keys) {
  const totals = Object.fromEntries(keys.map((key) => [key, { fixed: 0, flexible: 0 }]));
  for (const tx of transactions) {
    const value = signedAmount(tx);
    if (value === null || txType(tx) === 'income') continue;
    const bucket = totals[txMonthKey(tx)];
    if (!bucket) continue;
    if (tx.recurring_template_id) bucket.fixed += value;
    else bucket.flexible += value;
  }
  return keys.map((key) => ({ key, ...totals[key] }));
}

/**
 * Normalize a payee for grouping: lower case, trimmed, single spaces, with
 * trailing store numbers removed ("Costco #123", "SHELL 0042", "Store 12").
 * Returns '' for empty input.
 */
export function normalizePayee(value) {
  const base = String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  let s = base;
  let prev;
  do {
    prev = s;
    s = s.replace(/(?:\s*#\s*\d+|\s+(?:store|no\.?)\s*#?\s*\d+|\s+\d{3,})$/, '').trim();
  } while (s !== prev);
  return s || base;
}

/**
 * Group transactions by normalized payee (falling back to the description)
 * and break each group down by category.
 *
 * A payee is `mixed` when it has at least `minCount` transactions spread over
 * more than one category. Payees whose normalized key is in `ignore` are
 * flagged `ignored` and never `mixed`.
 *
 * @returns {Array<{
 *   key: string, label: string, count: number, total: number,
 *   categories: Array<{ categoryId: string, name: string, color: string | null, count: number, total: number }>,
 *   mixed: boolean, ignored: boolean,
 * }>} sorted by count, then total, descending
 */
export function payeeGroups(transactions, { ignore = [], minCount = 3 } = {}) {
  const ignored = new Set(ignore.map(normalizePayee));
  const groups = new Map();

  for (const tx of transactions) {
    const value = signedAmount(tx);
    if (value === null) continue;
    const raw = tx.payee?.trim() || tx.description?.trim() || '';
    const key = normalizePayee(raw);
    if (!key) continue;

    let group = groups.get(key);
    if (!group) {
      group = { key, labels: new Map(), count: 0, total: 0, categories: new Map() };
      groups.set(key, group);
    }
    group.count += 1;
    group.total += value;
    group.labels.set(raw, (group.labels.get(raw) ?? 0) + 1);

    const id = txCategoryId(tx);
    let cat = group.categories.get(id);
    if (!cat) {
      cat = { categoryId: id, name: tx.categories?.name || 'Uncategorized', color: tx.categories?.color ?? null, count: 0, total: 0 };
      group.categories.set(id, cat);
    }
    cat.count += 1;
    cat.total += value;
  }

  const byCountThenTotal = (a, b) => b.count - a.count || Math.abs(b.total) - Math.abs(a.total);

  return [...groups.values()]
    .map((group) => {
      const categories = [...group.categories.values()].sort(byCountThenTotal);
      // Display the most common original spelling.
      const label = [...group.labels.entries()].sort((a, b) => b[1] - a[1])[0][0];
      const isIgnored = ignored.has(group.key);
      return {
        key: group.key,
        label,
        count: group.count,
        total: group.total,
        categories,
        mixed: !isIgnored && group.count >= minCount && categories.length > 1,
        ignored: isIgnored,
      };
    })
    .sort(byCountThenTotal);
}

/**
 * Sankey graph for one period: income categories → "Income" → spending types
 * → spending categories. Only positive totals become links. When spending
 * exceeds income a "From savings & other" source covers the gap; when income
 * exceeds spending the remainder flows to "Left over".
 *
 * @returns {{
 *   nodes: Array<{ name: string, kind: 'income' | 'hub' | 'type' | 'category' | 'leftover' | 'shortfall', id?: string, color?: string | null }>,
 *   links: Array<{ source: number, target: number, value: number }>,
 * }}
 */
export function flowGraph(transactions) {
  const incomeByCategory = new Map();
  const spendByCategory = new Map();

  for (const tx of transactions) {
    const value = signedAmount(tx);
    if (value === null) continue;
    const type = txType(tx);
    const id = txCategoryId(tx);
    const target = type === 'income' ? incomeByCategory : spendByCategory;
    const entry = target.get(id) ?? {
      id,
      type,
      name: tx.categories?.name || 'Uncategorized',
      color: tx.categories?.color ?? null,
      total: 0,
    };
    entry.total += value;
    target.set(id, entry);
  }

  const nodes = [];
  const links = [];
  const addNode = (node) => nodes.push(node) - 1;

  const hub = addNode({ name: 'Income', kind: 'hub' });
  let incomeTotal = 0;
  for (const entry of [...incomeByCategory.values()].sort((a, b) => b.total - a.total)) {
    if (entry.total <= 0) continue;
    incomeTotal += entry.total;
    links.push({ source: addNode({ name: entry.name, kind: 'income', id: entry.id, color: entry.color }), target: hub, value: entry.total });
  }

  let spendTotal = 0;
  const spendingTypes = [...SPENDING_TYPES, 'other'];
  for (const type of spendingTypes) {
    const cats = [...spendByCategory.values()]
      .filter((entry) => entry.type === type && entry.total > 0)
      .sort((a, b) => b.total - a.total);
    const typeTotal = cats.reduce((sum, entry) => sum + entry.total, 0);
    if (typeTotal <= 0) continue;
    spendTotal += typeTotal;
    const name = type === 'other' ? 'Other' : type[0].toUpperCase() + type.slice(1);
    const typeNode = addNode({ name, kind: 'type', id: type });
    links.push({ source: hub, target: typeNode, value: typeTotal });
    for (const entry of cats) {
      links.push({ source: typeNode, target: addNode({ name: entry.name, kind: 'category', id: entry.id, color: entry.color }), value: entry.total });
    }
  }

  if (incomeTotal > spendTotal) {
    links.push({ source: hub, target: addNode({ name: 'Left over', kind: 'leftover' }), value: incomeTotal - spendTotal });
  } else if (spendTotal > incomeTotal) {
    links.unshift({ source: addNode({ name: 'From savings & other', kind: 'shortfall' }), target: hub, value: spendTotal - incomeTotal });
  }

  return links.length > 0 ? { nodes, links } : { nodes: [], links: [] };
}
