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
  assert.equal(savingsRate({ income: 1000, needs: 500, wants: 300 }), 0.2);
  assert.equal(savingsRate({ income: 1000, needs: 900, wants: 300 }), -0.2);
  assert.equal(savingsRate({ income: 0, needs: 100 }), null);
});

test('typeMixByMonth reports every requested month', () => {
  const m = categoryMonthMatrix([
    tx('salary', 1000, '2026-01-01'),
    tx('rent', 500, '2026-01-01'),
    tx('dining', 100, '2026-01-02'),
    tx('invest', 200, '2026-01-03'),
  ]);
  assert.deepEqual(typeMixByMonth(m, ['2026-01', '2026-02']), [
    { key: '2026-01', income: 1000, needs: 500, wants: 100, savings: 200, savingsRate: 0.4 },
    { key: '2026-02', income: 0, needs: 0, wants: 0, savings: 0, savingsRate: null },
  ]);
});

test('fixedFlexibleByMonth splits recurring-generated spending from the rest', () => {
  const rows = [
    tx('rent', 150000, '2026-01-01', { recurring_template_id: 'r1' }),
    tx('groceries', 20000, '2026-01-05'),
    tx('dining', 1000, '2026-01-06', { is_income: true }), // refund lowers flexible
    tx('salary', 400000, '2026-01-15', { recurring_template_id: 'r2' }), // income skipped
    tx('transfer', 5000, '2026-01-20', { recurring_template_id: 'r3' }), // transfer skipped
    tx('groceries', 7000, '2025-12-30'), // outside range
  ];
  assert.deepEqual(fixedFlexibleByMonth(rows, ['2026-01']), [
    { key: '2026-01', fixed: 150000, flexible: 19000 },
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
    'Income>Left over:400',
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
