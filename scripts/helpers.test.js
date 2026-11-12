import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  CATEGORY_TYPE_LABELS,
  CATEGORY_TYPE_ORDER,
  isSettledTransaction,
  parseBudgetCSV,
  resolveAmountOverride,
  setSafeModeEnabled,
  toDollars,
  toDateString,
} from '../src/utils/helpers.js';
import { getConnectionErrorMessage } from '../src/utils/connectionErrors.js';
import { getOccurrencesInRange } from '../src/utils/recurringCalculations.js';

test('shared category order and labels preserve all five UI groups', () => {
  assert.deepEqual(CATEGORY_TYPE_ORDER, ['income', 'needs', 'wants', 'savings', 'transfer']);
  assert.deepEqual(CATEGORY_TYPE_ORDER.map((type) => CATEGORY_TYPE_LABELS[type]),
    ['Income', 'Needs', 'Wants', 'Savings', 'Transfer']);
});

test('settled-transaction filter keeps only posted rows dated on or before as-of', () => {
  const asOf = '2026-11-10';
  const tx = (status, transaction_date) => ({ status, transaction_date });
  assert.equal(isSettledTransaction(tx('posted', '2026-11-10'), asOf), true);
  assert.equal(isSettledTransaction(tx('posted', '2026-01-01'), asOf), true);
  assert.equal(isSettledTransaction(tx(undefined, '2026-11-09'), asOf), true);
  assert.equal(isSettledTransaction(tx('posted', '2026-11-11'), asOf), false);
  assert.equal(isSettledTransaction(tx('pending', '2026-11-01'), asOf), false);
  assert.equal(isSettledTransaction(tx('projected', '2026-12-01'), asOf), false);
  for (const status of ['posted', 'pending', 'projected']) {
    assert.equal(isSettledTransaction(tx(status, '2027-06-01'), null), true);
  }
});

test('local date formatting pads fields and preserves leap days', () => {
  assert.equal(toDateString(new Date(2024, 1, 29, 23, 59)), '2024-02-29');
  assert.equal(toDateString(new Date(2026, 0, 2)), '2026-01-02');
});

for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
  test(`local date formatting and tomorrow calculation preserve boundaries in ${timezone}`, () => {
    const moduleUrl = new URL('../src/utils/helpers.js', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { toDateString } from ${JSON.stringify(moduleUrl)};
      assert.equal(toDateString(new Date(2026, 0, 1, 0, 5)), '2026-01-01');
      assert.equal(toDateString(new Date(2026, 0, 1, 23, 55)), '2026-01-01');
      for (const [year, month, day, expected] of [
        [2026, 11, 31, '2027-01-01'],
        [2024, 1, 28, '2024-02-29'],
        [2024, 1, 29, '2024-03-01'],
        [2026, 2, 8, '2026-03-09'],
        [2026, 10, 1, '2026-11-02'],
      ]) {
        const date = new Date(year, month, day, 12);
        date.setDate(date.getDate() + 1);
        assert.equal(toDateString(date), expected);
      }
    `], { encoding: 'utf8', env: { ...process.env, TZ: timezone } });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
  });
}

test('manual payment override: blank means no override, zero and junk are rejected', () => {
  assert.deepEqual(resolveAmountOverride('', 5000), { amountOverride: null, error: null });
  assert.deepEqual(resolveAmountOverride('   ', 5000), { amountOverride: null, error: null });
  assert.deepEqual(resolveAmountOverride('50', 5000), { amountOverride: null, error: null });
  assert.deepEqual(resolveAmountOverride('50.00', 5000), { amountOverride: null, error: null });
  assert.deepEqual(resolveAmountOverride('42.10', 5000), { amountOverride: 4210, error: null });
  assert.deepEqual(resolveAmountOverride('', 5000, true), { amountOverride: null, error: null });
  assert.deepEqual(resolveAmountOverride('12', 5000, true), { amountOverride: null, error: null });
  for (const bad of ['0', '0.00', '-5', 'abc', '0.001']) {
    const result = resolveAmountOverride(bad, 5000);
    assert.equal(result.amountOverride, null, bad);
    assert.ok(result.error, bad);
  }
});

test('raw toDollars is unaffected by safe mode so editable prefills round-trip', () => {
  setSafeModeEnabled(true);
  try {
    assert.equal(toDollars(123456, { raw: true }), 1234.56);
    assert.equal(Math.round(toDollars(123456, { raw: true }) * 100), 123456);
  } finally {
    setSafeModeEnabled(false);
  }
});

// SVC-10
test('budget CSV parser honours quoted fields with embedded commas', () => {
  const { rows, error } = parseBudgetCSV(
    'Category,Jan,Feb\r\n"Rent, Utilities","$1,234.50",900\nGroceries,"1,000",\n',
  );
  assert.equal(error, null);
  assert.deepEqual(rows.map((row) => row.categoryName), ['Rent, Utilities', 'Groceries']);
  assert.deepEqual(rows[0].monthAmounts.slice(0, 3), [1234.5, 900, 0]);
  assert.deepEqual(rows[1].monthAmounts.slice(0, 3), [1000, 0, 0]);
});

test('budget CSV month headers match names and abbreviations exactly', () => {
  const { rows, error } = parseBudgetCSV(
    'Category,Marketing,Notes,March,sept,Dec.,JUNE\nFood,1,2,3,4,5,6\n',
  );
  assert.equal(error, null);
  const expected = new Array(12).fill(0);
  expected[2] = 3; // March — not overwritten by "Marketing"
  expected[8] = 4;
  expected[11] = 5;
  expected[5] = 6;
  assert.deepEqual(rows[0].monthAmounts, expected);

  assert.match(parseBudgetCSV('Category,Marketing,Junk\nFood,1,2\n').error, /No recognizable month columns/);
});

test('budget CSV parser still reports empty input, bad numbers and missing names', () => {
  assert.equal(parseBudgetCSV('  ').error, 'File is empty.');
  assert.match(parseBudgetCSV('Category,Jan\n').error, /header row and at least one data row/);
  const { rows, error } = parseBudgetCSV('Category,Jan\n,5\nFood,abc\nFun,-20\n');
  assert.deepEqual(rows.map((row) => row.categoryName), ['Food', 'Fun']);
  assert.equal(rows[1].monthAmounts[0], 20);
  assert.match(error, /Row 2: missing category name/);
  assert.match(error, /Row 3, "Jan": "abc" is not a valid number/);
});

// SVC-15
test('connection error message reports a device that is offline', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const setNavigator = (value) =>
    Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
  try {
    // Like the browser, onLine lives on the prototype, not the instance.
    setNavigator(Object.create({ onLine: false }));
    assert.match(getConnectionErrorMessage(new Error('Failed to fetch')), /appears offline/);
    setNavigator(Object.create({ onLine: true }));
    assert.match(getConnectionErrorMessage(new Error('Failed to fetch')), /Could not reach the server/);
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
});

// SVC-16
test('occurrence range is not truncated for daily templates but stays bounded', () => {
  const daily = { frequency: 'custom', custom_unit: 'days', custom_interval: 1, start_date: '2026-01-01' };
  const days = getOccurrencesInRange(daily, '2026-03-01', '2026-05-30');
  assert.equal(days.length, 91);
  assert.equal(toDateString(days[0]), '2026-03-01');
  assert.equal(toDateString(days.at(-1)), '2026-05-30');
  assert.equal(getOccurrencesInRange(daily, '2026-01-01', '2026-12-31').length, 365);
  assert.equal(getOccurrencesInRange(daily, '2026-03-01', '2026-05-30', 10).length, 10);
  assert.deepEqual(getOccurrencesInRange(daily, '2026-05-30', '2026-03-01'), []);
  const monthly = { frequency: 'monthly', day_of_month: 15, start_date: '2026-01-01' };
  assert.equal(getOccurrencesInRange(monthly, '2026-03-01', '2026-05-30').length, 3);
});
