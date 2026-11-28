import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  averageMonths,
  categoryMonthMatrix,
  drillDownTransactions,
  fixedFlexibleByMonth,
  flowGraph,
  monthKey,
  monthRange,
  normalizePayee,
  payeeGroups,
  savingsRate,
  shiftMonth,
  signedAmount,
  sumMonths,
  typeMixByMonth,
} from '../src/utils/reportAggregations.js';

const CATS = {
  salary: { id: 'sal', name: 'Salary', type: 'income', color: '#0a0' },
  rent: { id: 'rent', name: 'Rent', type: 'needs', color: '#a00' },
  groceries: { id: 'gro', name: 'Groceries', type: 'needs', color: '#aa0' },
  dining: { id: 'din', name: 'Dining', type: 'wants', color: '#00a' },
  invest: { id: 'inv', name: 'Investing', type: 'savings', color: '#0aa' },
  transfer: { id: 'xfer', name: 'Transfer', type: 'transfer', color: null },
};

let seq = 0;
function tx(cat, amount, date, extra = {}) {
  const c = CATS[cat];
  seq += 1;
  return {
    id: `t${seq}`,
    category_id: c.id,
    categories: c,
    amount,
    is_income: c.type === 'income',
    transaction_date: date,
    ...extra,
  };
}

test('month helpers shift across year boundaries and list ranges oldest first', () => {
  assert.equal(monthKey(2026, 3), '2026-03');
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2025, 12, 1), { year: 2026, month: 1 });
  assert.deepEqual(shiftMonth(2026, 2, -14), { year: 2024, month: 12 });
  assert.deepEqual(monthRange(2026, 2, 4), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.deepEqual(monthRange(2026, 2, 0), []);
});

test('signedAmount follows classification, not the stored sign, and skips transfers', () => {
  assert.equal(signedAmount(tx('salary', 500000, '2026-01-01')), 500000);
  assert.equal(signedAmount(tx('salary', -2000, '2026-01-01', { is_income: false })), -2000);
  assert.equal(signedAmount(tx('groceries', -8000, '2026-01-01')), 8000);
  assert.equal(signedAmount(tx('groceries', 1500, '2026-01-01', { is_income: true })), -1500);
  assert.equal(signedAmount(tx('transfer', 10000, '2026-01-01')), null);
});

test('categoryMonthMatrix totals by category and type per month', () => {
  const rows = [
    tx('salary', 400000, '2026-01-15'),
    tx('rent', 150000, '2026-01-01'),
    tx('groceries', 20000, '2026-01-05'),
    tx('groceries', 3000, '2026-01-09', { is_income: true }), // refund
    tx('groceries', 25000, '2026-02-05'),
    tx('transfer', 99999, '2026-01-20'),
  ];
  const m = categoryMonthMatrix(rows);
  assert.deepEqual(m.byCategory.gro, { '2026-01': 17000, '2026-02': 25000 });
  assert.deepEqual(m.byType.needs, { '2026-01': 167000, '2026-02': 25000 });
  assert.deepEqual(m.byType.income, { '2026-01': 400000 });
  assert.equal(m.byCategory.xfer, undefined);
  assert.deepEqual(m.meta.gro, { name: 'Groceries', color: '#aa0', type: 'needs' });
});

test('sumMonths and averageMonths count missing months as zero', () => {
  const row = { '2026-01': 300, '2026-03': 600 };
  const keys = ['2026-01', '2026-02', '2026-03'];
  assert.equal(sumMonths(row, keys), 900);
  assert.equal(averageMonths(row, keys), 300);
  assert.equal(sumMonths(undefined, keys), 0);
  assert.equal(averageMonths(row, []), 0);
});

test('savings rate is income minus needs and wants over income', () => {
  assert.equal(savingsRate({ income: 1000, saved: 200 }), 0.2);
  assert.equal(savingsRate({ income: 1000, saved: -200 }), -0.2);
  assert.equal(savingsRate({ income: 0, saved: 100 }), null);
});

test('typeMixByMonth reports every requested month', () => {
  const m = categoryMonthMatrix([
    tx('salary', 1000, '2026-01-01'),
    tx('rent', 500, '2026-01-01'),
    tx('dining', 100, '2026-01-02'),
    tx('invest', 200, '2026-01-03'),
  ]);
  assert.deepEqual(typeMixByMonth(m, ['2026-01', '2026-02']), [
    { key: '2026-01', income: 1000, needs: 500, wants: 100, savings: 200, transferred: 0, saved: 200, savingsRate: 0.2 },
    { key: '2026-02', income: 0, needs: 0, wants: 0, savings: 0, transferred: 0, saved: 0, savingsRate: null },
  ]);
});

test('fixedFlexibleByMonth splits bills from flexible consumption spending', () => {
  const rows = [
    tx('rent', 150000, '2026-01-01', { recurring_template_id: 'r1' }),
    tx('groceries', 20000, '2026-01-05'),
    tx('dining', 1000, '2026-01-06', { is_income: true }), // refund lowers flexible
    tx('salary', 400000, '2026-01-15', { recurring_template_id: 'r2' }), // income skipped
    tx('invest', 50000, '2026-01-15'), // savings skipped
    tx('transfer', 5000, '2026-01-20', { recurring_template_id: 'r3' }), // transfer skipped
    tx('groceries', 7000, '2025-12-30'), // outside range
    // Hand-entered phone bill, same amount 3 months running: fixed.
    tx('rent', 6000, '2025-11-10', { payee: 'FiberNet' }),
    tx('rent', 6000, '2025-12-10', { payee: 'FiberNet' }),
    tx('rent', 6000, '2026-01-10', { payee: 'FiberNet' }),
  ];
  assert.deepEqual(fixedFlexibleByMonth(rows, ['2026-01']), [
    { key: '2026-01', fixed: 156000, flexible: 19000 },
  ]);
});

test('normalizePayee folds case, spacing and trailing store numbers', () => {
  assert.equal(normalizePayee('  COSTCO   #123 '), 'costco');
  assert.equal(normalizePayee('Shell 0042'), 'shell');
  assert.equal(normalizePayee('Target Store 12'), 'target');
  assert.equal(normalizePayee('Target store #0012'), 'target');
  assert.equal(normalizePayee('Route 66 Diner'), 'route 66 diner');
  assert.equal(normalizePayee('abc123'), 'abc123');
  assert.equal(normalizePayee('Store 12'), 'store 12');
  assert.equal(normalizePayee('#1234'), '#1234');
  assert.equal(normalizePayee(null), '');
});

test('payeeGroups flags payees spread over several categories', () => {
  const rows = [
    tx('groceries', 5000, '2026-01-01', { payee: 'Costco #12' }),
    tx('groceries', 6000, '2026-01-08', { payee: 'COSTCO #45' }),
    tx('dining', 2000, '2026-01-09', { payee: 'Costco #12' }),
    tx('dining', 1500, '2026-01-10', { payee: null, description: 'Taco Spot' }),
    tx('dining', 1500, '2026-01-11', { payee: null, description: 'Taco Spot' }),
    tx('groceries', 900, '2026-01-12', { payee: 'Taco Spot' }),
    tx('transfer', 9999, '2026-01-12', { payee: 'Costco' }),
  ];
  const groups = payeeGroups(rows);
  const costco = groups.find((g) => g.key === 'costco');
  assert.equal(costco.label, 'Costco #12');
  assert.equal(costco.count, 3);
  assert.equal(costco.total, 13000);
  assert.equal(costco.mixed, true);
  assert.deepEqual(costco.categories.map((c) => [c.categoryId, c.count, c.total]), [['gro', 2, 11000], ['din', 1, 2000]]);

  const taco = groups.find((g) => g.key === 'taco spot');
  assert.equal(taco.mixed, true);

  const ignored = payeeGroups(rows, { ignore: ['COSTCO'] }).find((g) => g.key === 'costco');
  assert.equal(ignored.mixed, false);
  assert.equal(ignored.ignored, true);

  assert.equal(payeeGroups(rows, { minCount: 4 }).some((g) => g.mixed), false);
});

test('drillDownTransactions selects one category and never transfers', () => {
  const rows = [tx('groceries', 100, '2026-01-01'), tx('dining', 100, '2026-01-01'), tx('transfer', 100, '2026-01-01')];
  assert.deepEqual(drillDownTransactions(rows, 'gro').map((t) => t.category_id), ['gro']);
  assert.deepEqual(drillDownTransactions(rows, 'xfer'), []);
});

function flowSummary({ nodes, links }) {
  return links.map((l) => `${nodes[l.source].name}>${nodes[l.target].name}:${l.value}`);
}

test('flowGraph routes income through types to categories with a left-over node', () => {
  const graph = flowGraph([
    tx('salary', 1000, '2026-01-01'),
    tx('rent', 500, '2026-01-01'),
    tx('groceries', 100, '2026-01-01'),
    tx('dining', 150, '2026-01-01'),
    tx('dining', 200, '2026-01-02', { is_income: true }), // net negative: dropped
    tx('transfer', 50, '2026-01-01'),
  ]);
  assert.deepEqual(flowSummary(graph), [
    'Salary>Income:1000',
    'Income>Needs:600',
    'Needs>Rent:500',
    'Needs>Groceries:100',
    'Income>Left in checking:400',
  ]);
});

test('flowGraph adds a shortfall source when spending exceeds income', () => {
  const graph = flowGraph([tx('salary', 100, '2026-01-01'), tx('rent', 300, '2026-01-01')]);
  assert.deepEqual(flowSummary(graph), [
    'From savings & other>Income:200',
    'Salary>Income:100',
    'Income>Needs:300',
    'Needs>Rent:300',
  ]);
  assert.deepEqual(flowGraph([]), { nodes: [], links: [] });
});

// ── Categories tab ──
import {
  categoryComparisonGroups,
  categoryTotals,
  comparisonPeriod,
  plannedByCategory,
  reportPeriodKeys,
  resolveCompareMode,
  yearsForKeys,
} from '../src/utils/reportAggregations.js';

test('compare modes fall back to plan when not offered for the period', () => {
  assert.equal(resolveCompareMode('monthly', 'avg3'), 'avg3');
  assert.equal(resolveCompareMode('ytd', 'avg3'), 'plan');
  assert.equal(resolveCompareMode('monthly', 'lastYear'), 'plan');
  assert.equal(resolveCompareMode('ytd', 'lastYear'), 'lastYear');
});

test('period and comparison keys cross year boundaries', () => {
  assert.deepEqual(reportPeriodKeys(2026, 3, 'monthly'), ['2026-03']);
  assert.deepEqual(reportPeriodKeys(2026, 3, 'ytd'), ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(comparisonPeriod(2026, 1, 'monthly', 'lastMonth'), { keys: ['2025-12'], divisor: 1, plan: false });
  assert.deepEqual(comparisonPeriod(2026, 2, 'monthly', 'avg3'), { keys: ['2025-11', '2025-12', '2026-01'], divisor: 3, plan: false });
  assert.deepEqual(comparisonPeriod(2026, 2, 'ytd', 'lastYear'), { keys: ['2025-01', '2025-02'], divisor: 1, plan: false });
  assert.deepEqual(comparisonPeriod(2026, 2, 'ytd', 'avg3'), { keys: ['2026-01', '2026-02'], divisor: 1, plan: true });
  assert.deepEqual(yearsForKeys(['2026-02'], ['2025-11', '2025-12', '2026-01']), [2025, 2026]);
});

test('plannedByCategory sums allocations over the period months of one year', () => {
  const annual = { 1: { allocations: { a: 100, b: 50 } }, 2: { allocations: { a: 120 } } };
  assert.deepEqual(plannedByCategory(annual, ['2026-01', '2026-02', '2026-03'], 2026), { a: 220, b: 50 });
  assert.deepEqual(plannedByCategory(annual, ['2025-12'], 2026), {});
  assert.deepEqual(plannedByCategory(undefined, ['2026-01'], 2026), {});
});

test('categoryTotals averages over the divisor and drops zero rows', () => {
  const m = categoryMonthMatrix([
    tx('groceries', 300, '2026-01-02'),
    tx('groceries', 400, '2026-02-02'),
    tx('dining', 100, '2026-01-03'),
    tx('dining', 100, '2026-01-04', { is_income: true }),
  ]);
  assert.deepEqual(categoryTotals(m, ['2026-01', '2026-02', '2026-03'], 3), { gro: 233 });
  assert.deepEqual(categoryTotals(m, ['2026-01']), { gro: 300 });
});

test('categoryComparisonGroups orders types, totals groups and skips transfers and empty rows', () => {
  const categories = [
    { id: 'sal', name: 'Salary', type: 'income', color: '#0a0' },
    { id: 'rent', name: 'Rent', type: 'needs', color: '#a00' },
    { id: 'gro', name: 'Groceries', type: 'needs', color: '#aa0', is_archived: true },
    { id: 'din', name: 'Dining', type: 'wants', color: '#00a' },
    { id: 'xfer', name: 'Transfer', type: 'transfer' },
  ];
  const groups = categoryComparisonGroups({
    actual: { sal: 5000, gro: 800, rent: 1500, xfer: 999, din: 0 },
    compare: { sal: 5000, rent: 1500, gro: 600, din: 0, ghost: 40 },
    categories,
    meta: { ghost: { name: 'Old', color: null, type: 'wants' } },
  });
  assert.deepEqual(groups.map((g) => [g.type, g.actual, g.compare]), [
    ['income', 5000, 5000],
    ['needs', 2300, 2100],
    ['wants', 0, 40],
  ]);
  assert.deepEqual(groups[1].rows.map((r) => [r.categoryId, r.change, r.archived]), [['rent', 0, false], ['gro', 200, true]]);
  assert.equal(groups[2].rows[0].name, 'Old');
});

// ── Overview tab ──
import { largestTransactions, periodSummary, planStatus, repeatingChargeKeys, topMovers } from '../src/utils/reportAggregations.js';

test('periodSummary separates consumption, savings and left over', () => {
  const m = categoryMonthMatrix([
    tx('salary', 10000, '2026-03-01'),
    tx('rent', 4000, '2026-03-01'),
    tx('dining', 1000, '2026-03-02'),
    tx('invest', 2000, '2026-03-03'),
    tx('rent', 4000, '2026-02-01'), // outside
  ]);
  assert.deepEqual(periodSummary(m, ['2026-03']), {
    income: 10000, needs: 4000, wants: 1000, savings: 2000, other: 0,
    spending: 5000, kept: 5000, transferred: 0, saved: 2000, leftOver: 3000, savingsRate: 0.2,
  });
  assert.equal(periodSummary(m, ['2026-01']).savingsRate, null);
});

test('topMovers ranks spending categories by absolute change and skips income', () => {
  const categories = [
    { id: 'sal', name: 'Salary', type: 'income' },
    { id: 'rent', name: 'Rent', type: 'needs' },
    { id: 'gro', name: 'Groceries', type: 'needs' },
    { id: 'din', name: 'Dining', type: 'wants' },
  ];
  const movers = topMovers({
    actual: { sal: 900000, rent: 150000, gro: 30000, din: 9000 },
    compare: { sal: 500000, rent: 150000, gro: 50000, din: 2000 },
    categories,
    minChange: 1000,
  });
  assert.deepEqual(movers.map((r) => [r.categoryId, r.change]), [['gro', -20000], ['din', 7000]]);
  assert.equal(topMovers({ actual: { din: 9000 }, compare: { din: 2000 }, categories, limit: 0 }).length, 0);
});

test('largestTransactions lists the biggest spending rows in the period only', () => {
  const rows = [
    tx('rent', -150000, '2026-03-01'),
    tx('groceries', -8000, '2026-03-05'),
    tx('groceries', 20000, '2026-03-06', { is_income: true }), // refund
    tx('salary', 500000, '2026-03-15'),
    tx('transfer', 900000, '2026-03-20'),
    tx('dining', -300000, '2026-02-10'), // other month
  ];
  assert.deepEqual(largestTransactions(rows, ['2026-03'], 5).map((t) => t.amount), [-150000, -8000]);
  rows[0].recurring_template_id = 'r1';
  assert.deepEqual(largestTransactions(rows, ['2026-03'], 5, { excludeBills: true }).map((t) => t.amount), [-8000]);
});

test('excludeBills also drops hand-entered charges repeating at the same amount', () => {
  const rent = (date) => tx('rent', -185000, date, { payee: 'Maple Court #2' });
  const rows = [
    rent('2026-01-01'), rent('2026-02-01'), rent('2026-03-01'),
    tx('groceries', -30000, '2026-03-04', { payee: 'Costco' }),
    tx('groceries', -31000, '2026-02-04', { payee: 'Costco' }),
    tx('groceries', -29000, '2026-01-04', { payee: 'Costco' }),
  ];
  assert.deepEqual([...repeatingChargeKeys(rows)], ['maple court|185000']);
  assert.deepEqual(largestTransactions(rows, ['2026-03'], 5, { excludeBills: true }).map((t) => t.payee), ['Costco']);
  // Only two months of rent: not yet a bill.
  assert.equal(largestTransactions(rows.slice(1), ['2026-03'], 1, { excludeBills: true })[0].payee, 'Maple Court #2');
});

test('planStatus counts over-plan categories and unbudgeted spending', () => {
  const categories = [
    { id: 'sal', name: 'Salary', type: 'income' },
    { id: 'rent', name: 'Rent', type: 'needs' },
    { id: 'gro', name: 'Groceries', type: 'needs' },
    { id: 'din', name: 'Dining', type: 'wants' },
  ];
  assert.deepEqual(planStatus({
    actual: { sal: 10, rent: 1500, gro: 700, din: 120 },
    planned: { sal: 0, rent: 1500, gro: 650 },
    categories,
  }), { overCount: 1, overIds: ['gro'], unbudgetedSpend: 120, unbudgetedCount: 1 });
});

// ── Categories › Payees ──
import {
  ignoredPayeesFrom,
  payeeKey,
  payeeTransactions,
  payeeWindowKeys,
  toggleIgnoredPayee,
} from '../src/utils/reportAggregations.js';

test('payee window covers the 12 months ending at the selected month', () => {
  const keys = payeeWindowKeys(2026, 3);
  assert.equal(keys.length, 12);
  assert.equal(keys[0], '2025-04');
  assert.equal(keys[11], '2026-03');
});

test('payeeTransactions matches the normalized payee and skips transfers', () => {
  const rows = [
    tx('groceries', 100, '2026-01-01', { payee: 'COSTCO #12' }),
    tx('dining', 100, '2026-01-02', { payee: 'Costco' }),
    tx('transfer', 100, '2026-01-03', { payee: 'Costco' }),
    tx('dining', 100, '2026-01-04', { payee: null, description: 'costco 0042' }),
    tx('dining', 100, '2026-01-05', { payee: 'Target' }),
  ];
  assert.equal(payeeKey(rows[3]), 'costco');
  assert.equal(payeeTransactions(rows, 'costco').length, 3);
});

test('ignore list parsing and toggling', () => {
  assert.deepEqual(ignoredPayeesFrom(null), []);
  assert.deepEqual(ignoredPayeesFrom({ payees: ['amazon', 3, 'target'] }), ['amazon', 'target']);
  assert.deepEqual(toggleIgnoredPayee(['target'], 'amazon'), ['amazon', 'target']);
  assert.deepEqual(toggleIgnoredPayee(['amazon', 'target'], 'amazon'), ['target']);
});

// ── Savings from transfers ──
import { transferSavingsByMonth } from '../src/utils/reportAggregations.js';

const ACCOUNTS = {
  checking: { id: 'a-chk', type: 'checking' },
  savings: { id: 'a-sav', type: 'savings' },
  brokerage: { id: 'a-brk', type: 'brokerage' },
  k401: { id: 'a-401', type: 'retirement' },
  card: { id: 'a-card', type: 'credit_card' },
};
/** A two-leg transfer; `fromCat` lets the outgoing leg carry a real category (linked transfer). */
function transferPair(from, to, amount, date, { fromCat = 'transfer', group = `g${seq + 1}` } = {}) {
  const out = tx(fromCat, -amount, date, { is_income: false, transfer_group_id: group, account_id: ACCOUNTS[from].id, accounts: ACCOUNTS[from] });
  const inn = tx('transfer', amount, date, { is_income: true, transfer_group_id: group, account_id: ACCOUNTS[to].id, accounts: ACCOUNTS[to] });
  return [out, inn];
}

test('plain transfers into savings accounts count as saved; withdrawals and moves between them net out', () => {
  const rows = [
    ...transferPair('checking', 'savings', 50000, '2026-03-05'),   // +500 saved
    ...transferPair('savings', 'checking', 20000, '2026-03-20'),   // −200 withdrawn
    ...transferPair('savings', 'brokerage', 30000, '2026-03-21'),  // 0: still saved
    ...transferPair('checking', 'card', 90000, '2026-03-17'),      // card payment: not savings
    ...transferPair('checking', 'k401', 10000, '2026-04-01'),      // next month
    tx('transfer', 7000, '2026-03-30', { is_income: true, accounts: ACCOUNTS.savings }), // adjustment, no group
  ];
  assert.deepEqual(transferSavingsByMonth(rows), { '2026-03': 30000, '2026-04': 10000 });
});

test('linked transfers count once, through their Savings category', () => {
  // 401k as a budget line: checking leg is Investing (savings type), the 401k leg is the transfer companion.
  const rows = transferPair('checking', 'k401', 50000, '2026-03-15', { fromCat: 'invest' });
  assert.deepEqual(transferSavingsByMonth(rows), {});
  const summary = periodSummary(categoryMonthMatrix([tx('salary', 400000, '2026-03-01'), ...rows]), ['2026-03']);
  assert.equal(summary.savings, 50000);
  assert.equal(summary.transferred, 0);
  assert.equal(summary.saved, 50000);
});

test('periodSummary adds budgeted and transferred savings and reports what is left in checking', () => {
  const rows = [
    tx('salary', 600000, '2026-03-01'),
    tx('rent', -200000, '2026-03-01'),
    tx('dining', -50000, '2026-03-02'),
    ...transferPair('checking', 'k401', 60000, '2026-03-15', { fromCat: 'invest' }), // budgeted
    ...transferPair('checking', 'savings', 150000, '2026-03-28'),                    // leftover moved
  ];
  const s = periodSummary(categoryMonthMatrix(rows), ['2026-03']);
  assert.equal(s.kept, 350000);
  assert.equal(s.savings, 60000);
  assert.equal(s.transferred, 150000);
  assert.equal(s.saved, 210000);
  assert.equal(s.leftOver, 140000);
  assert.equal(s.savingsRate, 0.35);
});

// ── Trends tab ──
import { biggestChanges, categorySeries, monthLabel, trendSeries } from '../src/utils/reportAggregations.js';

test('trendSeries adds spending, savings and chart labels per month', () => {
  const m = categoryMonthMatrix([
    tx('salary', 10000, '2026-01-01'),
    tx('rent', 4000, '2026-01-01'),
    tx('dining', 1000, '2026-01-02'),
    tx('invest', 2000, '2026-01-03'),
  ]);
  const [jan, feb] = trendSeries(m, ['2026-01', '2026-02']);
  assert.equal(monthLabel('2026-01'), 'Jan 2026');
  assert.deepEqual(
    { label: jan.label, year: jan.year, month: jan.month, spending: jan.spending, spent: jan.spent, saved: jan.saved, savingsRate: jan.savingsRate },
    { label: 'Jan 2026', year: 2026, month: 1, spending: 5000, spent: 5000, saved: 2000, savingsRate: 0.2 },
  );
  assert.equal(feb.spending, 0);
  assert.equal(feb.savingsRate, null);
});

test('categorySeries follows a category or a type, with zero months in the average', () => {
  const m = categoryMonthMatrix([
    tx('groceries', 300, '2026-01-02'),
    tx('rent', 900, '2026-01-01'),
    tx('groceries', 600, '2026-03-02'),
  ]);
  const keys = ['2026-01', '2026-02', '2026-03'];
  const gro = categorySeries(m, keys, { kind: 'category', id: 'gro' });
  assert.deepEqual(gro.points.map((p) => p.value), [300, 0, 600]);
  assert.equal(gro.average, 300);
  assert.deepEqual(categorySeries(m, keys, { kind: 'type', id: 'needs' }).points.map((p) => p.value), [1200, 0, 600]);
  assert.deepEqual(categorySeries(m, keys, { kind: 'category', id: 'nope' }).points.map((p) => p.value), [0, 0, 0]);
});

test('biggestChanges compares the latest 3 months with the 3 before', () => {
  const rows = [];
  for (const mo of ['01', '02', '03']) rows.push(tx('dining', 3000, `2026-${mo}-05`), tx('groceries', 60000, `2026-${mo}-05`));
  for (const mo of ['04', '05', '06']) rows.push(tx('dining', 9000, `2026-${mo}-05`), tx('groceries', 45000, `2026-${mo}-05`), tx('salary', 999999, `2026-${mo}-01`));
  const { risers, fallers } = biggestChanges(categoryMonthMatrix(rows), 2026, 6, { minChange: 1000 });
  assert.deepEqual(risers.map((r) => [r.categoryId, r.actual, r.compare, r.change]), [['din', 9000, 3000, 6000]]);
  assert.deepEqual(fallers.map((r) => [r.categoryId, r.change]), [['gro', -15000]]);
});

/** Sum of link values into and out of the hub node (index 0). */
function hubBalance({ links }) {
  const into = links.filter((l) => l.target === 0).reduce((s, l) => s + l.value, 0);
  const out = links.filter((l) => l.source === 0).reduce((s, l) => s + l.value, 0);
  return [into, out];
}

test('flowGraph puts budgeted and moved savings under Saved and balances the hub', () => {
  const graph = flowGraph([
    tx('salary', 6000, '2026-03-01'),
    tx('rent', -2000, '2026-03-01'),
    ...transferPair('checking', 'k401', 500, '2026-03-15', { fromCat: 'invest' }), // budgeted
    ...transferPair('checking', 'savings', 1500, '2026-03-28'),                    // moved
  ]);
  assert.deepEqual(flowSummary(graph), [
    'Salary>Income:6000',
    'Income>Needs:2000',
    'Needs>Rent:2000',
    'Income>Saved:2000',
    'Saved>Investing:500',
    'Saved>Moved to savings accounts:1500',
    'Income>Left in checking:2000',
  ]);
  assert.deepEqual(graph.nodes.find((n) => n.name === 'Saved'), { name: 'Saved', kind: 'type', id: 'saved' });
  const [into, out] = hubBalance(graph);
  assert.equal(into, out);
});

test('flowGraph treats a net withdrawal from savings as a source', () => {
  const graph = flowGraph([
    tx('salary', 1000, '2026-03-01'),
    tx('rent', -1800, '2026-03-01'),
    ...transferPair('savings', 'checking', 500, '2026-03-10'),
  ]);
  assert.deepEqual(flowSummary(graph), [
    'From savings & other>Income:800',
    'Salary>Income:1000',
    'Income>Needs:1800',
    'Needs>Rent:1800',
  ]);
  const [into, out] = hubBalance(graph);
  assert.equal(into, out);
});
