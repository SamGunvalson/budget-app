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

/** Account types whose balance counts as savings when money moves in or out. */
export const SAVINGS_ACCOUNT_TYPES = new Set(['savings', 'brokerage', 'retirement']);

/**
 * Net money moved into savings accounts by plain transfers, per month.
 *
 * Savings is recorded two ways: budgeted lines (a Savings-type category,
 * often as a linked transfer whose other leg lands in the 401k), and plain
 * transfers of whatever is left over (both legs use a transfer category).
 * Budgeted lines are already in `byType.savings`; this covers the plain
 * transfers. A leg arriving in a savings/brokerage/retirement account adds,
 * a leg leaving one subtracts, so savings → brokerage nets to zero and a
 * withdrawal to checking counts against the month. Transfer groups with any
 * non-transfer leg (linked transfers) are skipped so they count only once.
 * Single-account adjustments (no transfer group) are ignored.
 *
 * @returns {Record<string, number>} monthKey → cents
 */
export function transferSavingsByMonth(transactions) {
  const linkedGroups = new Set();
  for (const tx of transactions) {
    if (tx.transfer_group_id && tx.categories?.type !== 'transfer') linkedGroups.add(tx.transfer_group_id);
  }
  const totals = {};
  for (const tx of transactions) {
    if (!tx.transfer_group_id || tx.categories?.type !== 'transfer') continue;
    if (linkedGroups.has(tx.transfer_group_id)) continue;
    if (!SAVINGS_ACCOUNT_TYPES.has(tx.accounts?.type)) continue;
    const amount = Math.abs(tx.amount);
    const key = txMonthKey(tx);
    totals[key] = (totals[key] ?? 0) + (tx.is_income ? amount : -amount);
  }
  return totals;
}

/**
 * Category × month totals, plus plain transfers into savings accounts.
 *
 * @returns {{
 *   byCategory: Record<string, Record<string, number>>,  // categoryId → monthKey → cents
 *   byType: Record<string, Record<string, number>>,      // type → monthKey → cents
 *   meta: Record<string, { name: string, color: string | null, type: string }>,
 *   transferSavings: Record<string, number>,             // monthKey → cents (see transferSavingsByMonth)
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

  return { byCategory, byType, meta, transferSavings: transferSavingsByMonth(transactions) };
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
 * Savings rate = saved ÷ income, where saved is budgeted savings plus money
 * moved into savings accounts. Money left in checking does not count until
 * it is moved. Null when there is no positive income.
 */
export function savingsRate({ income, saved }) {
  if (!(income > 0)) return null;
  return saved / income;
}

/**
 * Income and spending-type totals per month, with money moved to savings
 * accounts (`transferred`), total `saved` and the savings rate.
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
      transferred: matrix.transferSavings?.[key] ?? 0,
    };
    const saved = row.savings + row.transferred;
    return { ...row, saved, savingsRate: savingsRate({ income: row.income, saved }) };
  });
}

/**
 * Consumption spending (needs, wants, other; not income, savings or
 * transfers) split into fixed bills and flexible spending, per month. A bill
 * is a row generated from a recurring template or a repeating same-amount
 * charge (see `billMatcher`), judged across all of `transactions`.
 * @returns {Array<{ key: string, fixed: number, flexible: number }>}
 */
export function fixedFlexibleByMonth(transactions, keys) {
  const isBill = billMatcher(transactions);
  const totals = Object.fromEntries(keys.map((key) => [key, { fixed: 0, flexible: 0 }]));
  for (const tx of transactions) {
    const value = signedAmount(tx);
    const type = txType(tx);
    if (value === null || type === 'income' || type === 'savings') continue;
    const bucket = totals[txMonthKey(tx)];
    if (!bucket) continue;
    if (isBill(tx)) bucket.fixed += value;
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
    const key = payeeKey(tx);
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
 * Sankey graph for one period: income categories → "Income" → Needs / Wants /
 * Saved / Other → categories. Saved holds the Savings-type categories plus a
 * "Moved to savings accounts" leaf for net plain transfers into savings
 * accounts (see `transferSavingsByMonth`), so it matches Overview's Saved.
 * Only positive totals become links. When outflows exceed income a
 * "From savings & other" source covers the gap (a net withdrawal from savings
 * counts here); when income exceeds them the remainder flows to "Left in
 * checking".
 *
 * Type nodes carry `id` 'needs' | 'wants' | 'saved' | 'other' (MIX_COLORS keys).
 *
 * @returns {{
 *   nodes: Array<{ name: string, kind: 'income' | 'hub' | 'type' | 'category' | 'moved' | 'leftover' | 'shortfall', id?: string, color?: string | null }>,
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
  const moved = Object.values(transferSavingsByMonth(transactions)).reduce((sum, v) => sum + v, 0);

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

  const TYPE_NODES = [
    { type: 'needs', id: 'needs', name: 'Needs' },
    { type: 'wants', id: 'wants', name: 'Wants' },
    { type: 'savings', id: 'saved', name: 'Saved' },
    { type: 'other', id: 'other', name: 'Other' },
  ];
  let outTotal = 0;
  for (const { type, id, name } of TYPE_NODES) {
    const cats = [...spendByCategory.values()]
      .filter((entry) => entry.type === type && entry.total > 0)
      .sort((a, b) => b.total - a.total);
    const extra = type === 'savings' && moved > 0 ? moved : 0;
    const typeTotal = cats.reduce((sum, entry) => sum + entry.total, 0) + extra;
    if (typeTotal <= 0) continue;
    outTotal += typeTotal;
    const typeNode = addNode({ name, kind: 'type', id });
    links.push({ source: hub, target: typeNode, value: typeTotal });
    for (const entry of cats) {
      links.push({ source: typeNode, target: addNode({ name: entry.name, kind: 'category', id: entry.id, color: entry.color }), value: entry.total });
    }
    if (extra > 0) {
      links.push({ source: typeNode, target: addNode({ name: 'Moved to savings accounts', kind: 'moved' }), value: extra });
    }
  }

  // Sources must equal outflows at the hub. A net withdrawal from savings is
  // money in alongside income; any remaining gap comes from other cash.
  const withdrawn = moved < 0 ? -moved : 0;
  const funding = incomeTotal + withdrawn;
  const fromOther = withdrawn + Math.max(outTotal - funding, 0);
  if (fromOther > 0) {
    links.unshift({ source: addNode({ name: 'From savings & other', kind: 'shortfall' }), target: hub, value: fromOther });
  }
  if (funding > outTotal) {
    links.push({ source: hub, target: addNode({ name: 'Left in checking', kind: 'leftover' }), value: funding - outTotal });
  }

  return links.length > 0 ? { nodes, links } : { nodes: [], links: [] };
}

// ── Categories tab: period + comparison ─────────────────────────────────────

/** Comparison choices per period mode. The first entry is the default. */
export const COMPARE_OPTIONS = {
  monthly: [
    { value: 'plan', label: 'Plan' },
    { value: 'lastMonth', label: 'Last month' },
    { value: 'avg3', label: '3-mo avg' },
  ],
  ytd: [
    { value: 'plan', label: 'Plan' },
    { value: 'lastYear', label: 'Last year' },
  ],
};

/** A compare mode valid for `viewMode` ('monthly' | 'ytd'), falling back to 'plan'. */
export function resolveCompareMode(viewMode, mode) {
  const options = COMPARE_OPTIONS[viewMode] ?? COMPARE_OPTIONS.monthly;
  return options.some((o) => o.value === mode) ? mode : 'plan';
}

/** Month keys covered by the selected period. YTD runs January through `month`. */
export function reportPeriodKeys(year, month, viewMode) {
  return viewMode === 'ytd' ? monthRange(year, month, month) : [monthKey(year, month)];
}

/**
 * Month keys whose actuals form the comparison value, and the divisor that
 * turns their sum into it (3 for a 3-month average). Plan mode compares
 * against the plan for the period's own months.
 * @returns {{ keys: string[], divisor: number, plan: boolean }}
 */
export function comparisonPeriod(year, month, viewMode, mode) {
  const resolved = resolveCompareMode(viewMode, mode);
  if (resolved === 'lastMonth') {
    const prev = shiftMonth(year, month, -1);
    return { keys: [monthKey(prev.year, prev.month)], divisor: 1, plan: false };
  }
  if (resolved === 'avg3') {
    const prev = shiftMonth(year, month, -1);
    return { keys: monthRange(prev.year, prev.month, 3), divisor: 3, plan: false };
  }
  if (resolved === 'lastYear') {
    return { keys: monthRange(year - 1, month, month), divisor: 1, plan: false };
  }
  return { keys: reportPeriodKeys(year, month, viewMode), divisor: 1, plan: true };
}

/** Calendar years whose transactions the period and its comparison need. */
export function yearsForKeys(...keyLists) {
  const years = new Set();
  for (const keys of keyLists) for (const key of keys) years.add(Number(key.slice(0, 4)));
  return [...years].sort((a, b) => a - b);
}

/**
 * Planned cents per category over `keys`, from `useAnnualBudgetData` output
 * (`{ [month]: { allocations: { [categoryId]: cents } } }`) for `year`.
 * Keys outside `year` are ignored.
 */
export function plannedByCategory(annualBudget, keys, year) {
  const totals = {};
  for (const key of keys) {
    if (Number(key.slice(0, 4)) !== year) continue;
    const allocations = annualBudget?.[Number(key.slice(5, 7))]?.allocations ?? {};
    for (const [id, cents] of Object.entries(allocations)) {
      totals[id] = (totals[id] ?? 0) + (cents ?? 0);
    }
  }
  return totals;
}

/** Per-category totals over `keys` divided by `divisor` (rounded to cents). */
export function categoryTotals(matrix, keys, divisor = 1) {
  const totals = {};
  for (const [id, row] of Object.entries(matrix.byCategory)) {
    const sum = sumMonths(row, keys);
    if (sum !== 0) totals[id] = Math.round(sum / divisor);
  }
  return totals;
}

const GROUP_ORDER = ['income', ...SPENDING_TYPES, 'other'];

/**
 * Category rows grouped by type (income, needs, wants, savings, other) with
 * group subtotals. Rows with neither an actual nor a comparison value are
 * left out; transfers never appear. Rows sort by the larger of actual and
 * comparison, descending.
 *
 * @param {{
 *   actual: Record<string, number>,
 *   compare: Record<string, number>,
 *   categories?: Array<{ id: string, name: string, color?: string, type: string, is_archived?: boolean }>,
 *   meta?: Record<string, { name: string, color: string | null, type: string }>,
 * }} input
 * @returns {Array<{ type: string, actual: number, compare: number, rows: Array<{
 *   categoryId: string, name: string, color: string | null, type: string,
 *   archived: boolean, actual: number, compare: number, change: number }> }>}
 */
export function categoryComparisonGroups({ actual, compare, categories = [], meta = {} }) {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const ids = new Set([...Object.keys(actual), ...Object.keys(compare)]);
  const groups = new Map();

  for (const id of ids) {
    const cat = byId.get(id);
    const info = meta[id];
    const rawType = cat?.type ?? info?.type ?? 'other';
    if (rawType === 'transfer') continue;
    const type = GROUP_ORDER.includes(rawType) ? rawType : 'other';
    const a = actual[id] ?? 0;
    const c = compare[id] ?? 0;
    if (a === 0 && c === 0) continue;

    if (!groups.has(type)) groups.set(type, { type, actual: 0, compare: 0, rows: [] });
    const group = groups.get(type);
    group.actual += a;
    group.compare += c;
    group.rows.push({
      categoryId: id,
      name: cat?.name ?? info?.name ?? 'Uncategorized',
      color: cat?.color ?? info?.color ?? null,
      type,
      archived: !!cat?.is_archived,
      actual: a,
      compare: c,
      change: a - c,
    });
  }

  for (const group of groups.values()) {
    group.rows.sort((x, y) => Math.max(y.actual, y.compare) - Math.max(x.actual, x.compare) || x.name.localeCompare(y.name));
  }
  return GROUP_ORDER.filter((type) => groups.has(type)).map((type) => groups.get(type));
}

// ── Overview tab ────────────────────────────────────────────────────────────

/**
 * Totals for a set of months.
 * - `spending`: consumption (needs + wants + other).
 * - `kept`: income − spending, what consumption didn't use.
 * - `savings`: budgeted savings (Savings-type categories).
 * - `transferred`: net plain transfers into savings accounts.
 * - `saved`: savings + transferred. `savingsRate` = saved ÷ income.
 * - `leftOver`: kept − saved, still sitting in checking (negative when more
 *   was saved than kept, i.e. drawn from earlier cash).
 */
export function periodSummary(matrix, keys) {
  const sum = (type) => sumMonths(matrix.byType[type], keys);
  const income = sum('income');
  const needs = sum('needs');
  const wants = sum('wants');
  const savings = sum('savings');
  const other = sum('other');
  const spending = needs + wants + other;
  const transferred = sumMonths(matrix.transferSavings, keys);
  const kept = income - spending;
  const saved = savings + transferred;
  return {
    income,
    needs,
    wants,
    savings,
    other,
    spending,
    kept,
    transferred,
    saved,
    leftOver: kept - saved,
    savingsRate: savingsRate({ income, saved }),
  };
}

/**
 * Spending categories (not income or transfers) whose actual moved most from
 * the comparison, largest absolute change first. Changes smaller than
 * `minChange` cents are ignored.
 */
export function topMovers({ actual, compare, categories = [], meta = {}, limit = 5, minChange = 1000 }) {
  const groups = categoryComparisonGroups({ actual, compare, categories, meta });
  return groups
    .filter((g) => g.type !== 'income')
    .flatMap((g) => g.rows)
    .filter((row) => Math.abs(row.change) >= minChange)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/**
 * Keys (`payee|amount`) of charges that repeat: the same normalized payee and
 * exact amount in at least `minMonths` different months. Catches bills that
 * were entered by hand rather than generated from a recurring template.
 */
export function repeatingChargeKeys(transactions, minMonths = 3) {
  const months = new Map();
  for (const tx of transactions) {
    const payee = payeeKey(tx);
    if (!payee) continue;
    const key = `${payee}|${Math.abs(tx.amount)}`;
    if (!months.has(key)) months.set(key, new Set());
    months.get(key).add(txMonthKey(tx));
  }
  return new Set([...months].filter(([, set]) => set.size >= minMonths).map(([key]) => key));
}

/**
 * A predicate telling whether a transaction is a bill: generated from a
 * recurring template, or a repeating same-amount charge in `transactions`.
 */
export function billMatcher(transactions) {
  const repeating = repeatingChargeKeys(transactions);
  return (tx) => !!tx.recurring_template_id || repeating.has(`${payeeKey(tx)}|${Math.abs(tx.amount)}`);
}

/**
 * The largest spending transactions (refunds, income and transfers excluded)
 * in `keys`. With `excludeBills`, rows generated from a recurring template and
 * repeating same-amount charges (see `repeatingChargeKeys`, judged across all
 * of `transactions`) are left out so one-off purchases surface.
 */
export function largestTransactions(transactions, keys, limit = 5, { excludeBills = false } = {}) {
  const inPeriod = new Set(keys);
  const isBill = excludeBills ? billMatcher(transactions) : () => false;
  return transactions
    .filter((tx) => inPeriod.has(txMonthKey(tx)) && txType(tx) !== 'income' && (signedAmount(tx) ?? 0) > 0)
    .filter((tx) => !excludeBills || !isBill(tx))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || b.transaction_date.localeCompare(a.transaction_date))
    .slice(0, limit);
}

/**
 * Plan health for spending categories: how many are over plan, and how much
 * was spent in categories with no plan.
 * @returns {{ overCount: number, overIds: string[], unbudgetedSpend: number, unbudgetedCount: number }}
 */
export function planStatus({ actual, planned, categories = [], meta = {} }) {
  const groups = categoryComparisonGroups({ actual, compare: planned, categories, meta });
  const rows = groups.filter((g) => g.type !== 'income').flatMap((g) => g.rows);
  const over = rows.filter((r) => r.compare > 0 && r.actual > r.compare);
  const unbudgeted = rows.filter((r) => r.compare === 0 && r.actual > 0);
  return {
    overCount: over.length,
    overIds: over.map((r) => r.categoryId),
    unbudgetedSpend: unbudgeted.reduce((s, r) => s + r.actual, 0),
    unbudgetedCount: unbudgeted.length,
  };
}

// ── Categories › Payees ─────────────────────────────────────────────────────

/** `user_preferences` key holding `{ payees: string[] }` of ignored normalized payees. */
export const IGNORED_PAYEES_PREF = 'payee_consistency_ignored';

/** Months the Payees view and the Overview mixed-payee count look at. */
export const PAYEE_WINDOW_MONTHS = 12;

/** The trailing payee window ending at (year, month), oldest first. */
export function payeeWindowKeys(year, month) {
  return monthRange(year, month, PAYEE_WINDOW_MONTHS);
}

/** Normalized payee key of a transaction (payee, else description). */
export function payeeKey(tx) {
  return normalizePayee(tx.payee?.trim() || tx.description?.trim() || '');
}

/** Non-transfer transactions whose normalized payee is `key`. */
export function payeeTransactions(transactions, key) {
  return transactions.filter((tx) => tx.categories?.type !== 'transfer' && payeeKey(tx) === key);
}

/** The ignored-payee list from its stored preference value (tolerates junk). */
export function ignoredPayeesFrom(pref) {
  return Array.isArray(pref?.payees) ? pref.payees.filter((p) => typeof p === 'string') : [];
}

/** Add `key` to the ignore list, or remove it when present; sorted, no duplicates. */
export function toggleIgnoredPayee(list, key) {
  const set = new Set(list);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  return [...set].sort();
}

// ── Trends tab ──────────────────────────────────────────────────────────────

const SHORT_MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Nov 2026" for a `YYYY-MM` key. */
export function monthLabel(key) {
  return `${SHORT_MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/**
 * One row per month for the Trends charts: income, consumption spending,
 * the type mix, savings (budgeted + moved) and the savings rate. `label`,
 * `year`, `month` and `spent` keep the shape TrendChart expects.
 */
export function trendSeries(matrix, keys) {
  return typeMixByMonth(matrix, keys).map((row) => {
    const other = matrix.byType.other?.[row.key] ?? 0;
    const spending = row.needs + row.wants + other;
    return {
      ...row,
      other,
      spending,
      spent: spending,
      label: monthLabel(row.key),
      year: Number(row.key.slice(0, 4)),
      month: Number(row.key.slice(5, 7)),
    };
  });
}

/**
 * Monthly totals for one category (`{ kind: 'category', id }`) or one type
 * (`{ kind: 'type', id: 'needs' }`) over `keys`, with their average.
 * @returns {{ points: Array<{ key: string, label: string, value: number }>, average: number }}
 */
export function categorySeries(matrix, keys, selection) {
  const row = selection?.kind === 'type'
    ? selection.id === 'saved'
      ? Object.fromEntries(keys.map((k) => [k, (matrix.byType.savings?.[k] ?? 0) + (matrix.transferSavings?.[k] ?? 0)]))
      : matrix.byType[selection.id]
    : matrix.byCategory[selection?.id];
  const points = keys.map((key) => ({ key, label: monthLabel(key), value: row?.[key] ?? 0 }));
  return { points, average: averageMonths(row, keys) };
}

/**
 * Spending categories whose monthly average over the latest `window` months
 * (ending at endYear/endMonth) moved most against the `window` months before.
 * Changes under `minChange` cents are ignored.
 * @returns {{ risers: Array<object>, fallers: Array<object> }} rows from
 *   categoryComparisonGroups (actual = recent average, compare = prior average)
 */
export function biggestChanges(matrix, endYear, endMonth, { window = 3, limit = 5, minChange = 1000, categories = [] } = {}) {
  const recentKeys = monthRange(endYear, endMonth, window);
  const priorEnd = shiftMonth(endYear, endMonth, -window);
  const priorKeys = monthRange(priorEnd.year, priorEnd.month, window);
  const rows = categoryComparisonGroups({
    actual: categoryTotals(matrix, recentKeys, window),
    compare: categoryTotals(matrix, priorKeys, window),
    categories,
    meta: matrix.meta,
  })
    .filter((g) => g.type !== 'income')
    .flatMap((g) => g.rows)
    .filter((r) => Math.abs(r.change) >= minChange);
  return {
    risers: rows.filter((r) => r.change > 0).sort((a, b) => b.change - a.change).slice(0, limit),
    fallers: rows.filter((r) => r.change < 0).sort((a, b) => a.change - b.change).slice(0, limit),
  };
}
