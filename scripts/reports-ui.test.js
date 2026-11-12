import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  amountInputError,
  cashflowDateRange,
  isValidCustomSplit,
  isWholeNumberInRange,
  linkedAccountError,
  planBudgetImportMonth,
  signedCategoryTotal,
  yearOptionsWithSelected,
} from '../src/utils/reportRules.js';
import { computeGroupNet, computeTemplateGroupNet } from '../src/utils/transactionGrouping.js';

const tx = (amount, is_income, type) => ({ amount, is_income, categories: { type } });

// ── RPT-9 ──
test('drill-down total subtracts refunds in a spending category', () => {
  const rows = [tx(-5000, false, 'needs'), tx(-2500, false, 'needs'), tx(1000, true, 'needs')];
  assert.equal(signedCategoryTotal(rows), 6500);
});

test('drill-down total subtracts debits in an income category', () => {
  const rows = [tx(200000, true, 'income'), tx(-15000, false, 'income')];
  assert.equal(signedCategoryTotal(rows), 185000);
});

test('drill-down total ignores the stored sign and can go negative', () => {
  assert.equal(signedCategoryTotal([tx(5000, false, 'wants'), tx(-5000, false, 'wants')]), 10000);
  assert.equal(signedCategoryTotal([tx(1000, false, 'wants'), tx(4000, true, 'wants')]), -3000);
  assert.equal(signedCategoryTotal([]), 0);
});

// ── RPT-10 ──
const child = (amount, is_income, is_transfer = false) => ({ amount, is_income, is_transfer });

test('template group net: income minus expenses minus outflow transfers', () => {
  const children = [child(300000, true), child(120000, false), child(50000, false, true)];
  assert.equal(computeTemplateGroupNet(children), 130000);
});

test('template group net excludes inflow transfers and tolerates empty input', () => {
  assert.equal(computeTemplateGroupNet([child(10000, true), child(4000, true, true)]), 10000);
  assert.equal(computeTemplateGroupNet([]), 0);
  assert.equal(computeTemplateGroupNet(undefined), 0);
});

test('template group net matches computeGroupNet for the same mixed group', () => {
  const children = [child(300000, true), child(120000, false), child(50000, false, true)];
  const asTransactions = children.map((c) => ({
    amount: c.is_income ? c.amount : -c.amount,
    is_income: c.is_income,
    categories: { type: c.is_transfer ? 'transfer' : c.is_income ? 'income' : 'needs' },
  }));
  assert.equal(computeTemplateGroupNet(children), computeGroupNet(asTransactions));
});

// ── RPT-12 ──
const cats = {
  salary: { id: 'c-sal', type: 'income' },
  rent: { id: 'c-rent', type: 'needs' },
  fun: { id: 'c-fun', type: 'wants' },
};
const months = (value) => Array.from({ length: 12 }, () => value);

test('budget import de-duplicates by category and totals income from the kept rows', () => {
  const rows = [
    { categoryName: 'Salary', monthAmounts: months(1000) },
    { categoryName: 'salary', monthAmounts: months(1500) }, // duplicate: last wins
    { categoryName: 'Rent', monthAmounts: months(800.5) },
    { categoryName: 'Unknown', monthAmounts: months(10) },
  ];
  const plan = planBudgetImportMonth({ rows, monthIndex: 0, categoriesByName: cats });
  assert.deepEqual(plan.items, [
    { category_id: 'c-sal', planned_amount: 150000 },
    { category_id: 'c-rent', planned_amount: 80050 },
  ]);
  assert.equal(plan.totalIncome, 150000); // not 250000
  assert.deepEqual(plan.staleCategoryIds, []);
});

test('budget import reports only stale existing items and clamps negatives', () => {
  const rows = [
    { categoryName: 'Rent', monthAmounts: [-50, 900, ...months(0).slice(2)] },
  ];
  const existingItems = [{ category_id: 'c-rent' }, { category_id: 'c-fun' }, { category_id: 'c-fun' }];
  const jan = planBudgetImportMonth({ rows, monthIndex: 0, categoriesByName: cats, existingItems });
  assert.deepEqual(jan.items, [{ category_id: 'c-rent', planned_amount: 0 }]);
  assert.deepEqual(jan.staleCategoryIds, ['c-fun']);
  assert.equal(jan.totalIncome, 0);
  const feb = planBudgetImportMonth({ rows, monthIndex: 1, categoriesByName: cats, existingItems });
  assert.deepEqual(feb.items, [{ category_id: 'c-rent', planned_amount: 90000 }]);
});

// ── RPT-13 ──
test('custom split needs two non-negative shares that sum to the total', () => {
  assert.equal(isValidCustomSplit(10000, 4000, 6000), true);
  assert.equal(isValidCustomSplit(10000, 0, 10000), true);
  assert.equal(isValidCustomSplit(10000, 12000, -2000), false);
  assert.equal(isValidCustomSplit(10000, -1, 10001), false);
  assert.equal(isValidCustomSplit(10000, 4000, 5000), false);
  assert.equal(isValidCustomSplit(10000, NaN, 10000), false);
});

// ── RPT-14 ──
test('cashflow range clamps month ends instead of overflowing', () => {
  assert.deepEqual(
    cashflowDateRange({ todayStr: '2026-01-31', pastMonths: 2, futureMonths: 1 }),
    { startDate: '2025-11-30', endDate: '2026-02-28' },
  );
  assert.deepEqual(
    cashflowDateRange({ todayStr: '2026-03-31', pastMonths: 1, futureMonths: 3 }),
    { startDate: '2026-02-28', endDate: '2026-06-30' },
  );
});

test('cashflow range: "all" goes back ten years and projectedToDate overrides the end', () => {
  assert.deepEqual(
    cashflowDateRange({ todayStr: '2024-02-29', pastMonths: null, futureMonths: 6, projectedToDate: '2027-01-15' }),
    { startDate: '2014-02-28', endDate: '2027-01-15' },
  );
  assert.equal(
    cashflowDateRange({ todayStr: '2026-11-12', pastMonths: 9, futureMonths: 3 }).endDate,
    '2027-02-12',
  );
});

// ── UI-8 (validate() must cover the native constraints noValidate turns off) ──
test('amount rule covers native min/step on the line-item amount', () => {
  assert.equal(amountInputError('12.34'), null);
  assert.equal(amountInputError('0.01'), null);
  assert.equal(amountInputError(''), 'Required');
  assert.equal(amountInputError('abc'), 'Required');
  assert.equal(amountInputError('0'), 'Required');
  assert.equal(amountInputError('-5'), 'Required');
  assert.equal(amountInputError('0.001'), 'Min 0.01');
  assert.equal(amountInputError('1.234'), 'Max 2 decimals');
  assert.equal(amountInputError('19.99'), null);
  assert.equal(amountInputError('1234.56'), null);
});

test('whole-number rule covers native min/max/step on interval and day inputs', () => {
  assert.equal(isWholeNumberInRange('1', 1, 31), true);
  assert.equal(isWholeNumberInRange('31', 1, 31), true);
  assert.equal(isWholeNumberInRange(15, 1, 31), true);
  assert.equal(isWholeNumberInRange('', 1, 31), false);
  assert.equal(isWholeNumberInRange('0', 1, 31), false);
  assert.equal(isWholeNumberInRange('32', 1, 31), false);
  assert.equal(isWholeNumberInRange('1.5', 1, 31), false);
  assert.equal(isWholeNumberInRange('366', 1, 365), false);
  assert.equal(isWholeNumberInRange('x', 1, 365), false);
});

// ── UI-15 ──
test('linked account must differ from the line item account', () => {
  assert.equal(linkedAccountError({ txType: 'expense', accountId: 'a', linkedAccountId: 'a' }), 'Must differ');
  assert.equal(linkedAccountError({ txType: 'income', accountId: 'a', linkedAccountId: 'b' }), null);
  assert.equal(linkedAccountError({ txType: 'expense', accountId: 'a', linkedAccountId: '' }), null);
  // Transfers use toAccountId, validated separately.
  assert.equal(linkedAccountError({ txType: 'transfer', accountId: 'a', linkedAccountId: 'a' }), null);
});

// ── UI-14 ──
test('year options include a selected year outside the list, keeping order', () => {
  const asc = [2024, 2025, 2026];
  assert.equal(yearOptionsWithSelected(asc, 2025), asc);
  assert.deepEqual(yearOptionsWithSelected(asc, 2028), [2024, 2025, 2026, 2028]);
  assert.deepEqual(yearOptionsWithSelected(asc, 2020), [2020, 2024, 2025, 2026]);
  assert.deepEqual(yearOptionsWithSelected([2026, 2025, 2024], 2027), [2027, 2026, 2025, 2024]);
  assert.deepEqual(yearOptionsWithSelected([2026, 2025, 2024], '2022'), [2026, 2025, 2024, 2022]);
  assert.equal(yearOptionsWithSelected(asc, undefined), asc);
});
