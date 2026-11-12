import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  categoryIdForTransactionType,
  filtersWithSearchText,
  isToAmountFieldVisible,
  isValidInlineAmount,
  isValidInlineDate,
  isValidInlineEdit,
  toAmountForAccountError,
} from '../src/utils/transactionFormRules.js';

// UI-2 — inline cell edits that the database would reject are not queued.
test('inline amount must be a finite number above zero cents', () => {
  for (const ok of ['12.34', '0.01', '5', 7, '1e2', ' 3.50 ']) {
    assert.equal(isValidInlineAmount(ok), true, `expected ${JSON.stringify(ok)} to be valid`);
  }
  for (const bad of ['', '   ', null, undefined, '0', '0.00', 0, '0.004', '-5', -1, 'abc', '1,000', 'NaN', 'Infinity', NaN, Infinity]) {
    assert.equal(isValidInlineAmount(bad), false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('inline date must be a real YYYY-MM-DD date', () => {
  for (const ok of ['2026-11-12', '2024-02-29', '1999-12-31']) {
    assert.equal(isValidInlineDate(ok), true, ok);
  }
  for (const bad of ['', null, undefined, '2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '2026-1-5', '11/12/2026', '2026-11-12T00:00:00', 'abc']) {
    assert.equal(isValidInlineDate(bad), false, String(bad));
  }
});

test('inline edit validation only restricts amount and date cells', () => {
  assert.equal(isValidInlineEdit('number', ''), false);
  assert.equal(isValidInlineEdit('number', '0'), false);
  assert.equal(isValidInlineEdit('number', '4.20'), true);
  assert.equal(isValidInlineEdit('date', ''), false);
  assert.equal(isValidInlineEdit('date', '2026-11-12'), true);
  // Payee/description may be cleared; selects are unrestricted.
  assert.equal(isValidInlineEdit('text', ''), true);
  assert.equal(isValidInlineEdit('select', 'cat-1'), true);
});

// UI-1 — the "amount applied to account" field is validated only when shown.
test('to-amount field is visible only with a destination or linked account', () => {
  const visible = (transactionType, toAccountId, linkedAccountId) =>
    isToAmountFieldVisible({ transactionType, toAccountId, linkedAccountId });
  assert.equal(visible('transfer', 'acct-b', ''), true);
  assert.equal(visible('transfer', '', ''), false); // single-account adjustment
  assert.equal(visible('transfer', '', 'acct-c'), false);
  assert.equal(visible('expense', '', 'acct-c'), true);
  assert.equal(visible('income', '', 'acct-c'), true);
  assert.equal(visible('expense', '', ''), false);
  assert.equal(visible('expense', 'acct-b', ''), false); // stale destination from a transfer
});

test('a hidden to-amount never produces a validation error', () => {
  const stale = { toAmountForAccount: '500', amount: '20' };
  assert.equal(toAmountForAccountError({ visible: false, ...stale }), null);
  assert.equal(toAmountForAccountError({ visible: false, toAmountForAccount: '-1', amount: '20' }), null);
  assert.equal(toAmountForAccountError({ visible: false, toAmountForAccount: 'abc', amount: '20' }), null);
});

test('a visible to-amount keeps the existing validation rules', () => {
  const check = (toAmountForAccount, amount) =>
    toAmountForAccountError({ visible: true, toAmountForAccount, amount });
  assert.equal(check('', '20'), null); // blank means the full amount
  assert.equal(check('15', '20'), null);
  assert.equal(check('20', '20'), null);
  assert.equal(check('0', '20'), 'Amount must be greater than 0.');
  assert.equal(check('-3', '20'), 'Amount must be greater than 0.');
  assert.equal(check('abc', '20'), 'Amount must be greater than 0.');
  assert.equal(check('500', '20'), 'Cannot exceed the total payment amount.');
  assert.equal(check('500', ''), null); // the amount field reports its own error
});

// UI-13 — category choice when the transaction type changes.
const categories = [
  { id: 'rent', type: 'needs' },
  { id: 'fun', type: 'wants' },
  { id: 'salary', type: 'income' },
  { id: 'bonus', type: 'income' },
  { id: 'nest', type: 'savings' },
  { id: 'move', type: 'transfer' },
  { id: 'adjust', type: 'transfer' },
];

test('switching to income picks an income category, not the first non-transfer one', () => {
  assert.equal(categoryIdForTransactionType(categories, 'rent', 'income'), 'salary');
  assert.equal(categoryIdForTransactionType(categories, '', 'income'), 'salary');
  assert.equal(categoryIdForTransactionType(categories, 'move', 'income'), 'salary');
});

test('the current category is kept when it fits the new type', () => {
  assert.equal(categoryIdForTransactionType(categories, 'bonus', 'income'), 'bonus');
  assert.equal(categoryIdForTransactionType(categories, 'fun', 'expense'), 'fun');
  assert.equal(categoryIdForTransactionType(categories, 'nest', 'expense'), 'nest');
  assert.equal(categoryIdForTransactionType(categories, 'adjust', 'transfer'), 'adjust');
});

test('switching to expense or transfer picks a category of that kind', () => {
  assert.equal(categoryIdForTransactionType(categories, 'salary', 'expense'), 'rent');
  assert.equal(categoryIdForTransactionType(categories, 'move', 'expense'), 'rent');
  assert.equal(categoryIdForTransactionType(categories, 'rent', 'transfer'), 'move');
  assert.equal(categoryIdForTransactionType(categories, 'gone', 'expense'), 'rent');
});

test('category choice falls back when no category matches the type exactly', () => {
  const spendingOnly = categories.filter((c) => c.type !== 'income');
  assert.equal(categoryIdForTransactionType(spendingOnly, 'fun', 'income'), 'rent');
  const incomeOnly = categories.filter((c) => c.type === 'income');
  assert.equal(categoryIdForTransactionType(incomeOnly, 'salary', 'expense'), 'salary');
  assert.equal(categoryIdForTransactionType(incomeOnly, 'salary', 'transfer'), '');
  assert.equal(categoryIdForTransactionType([], '', 'income'), '');
});

// UI-3 — the debounced search only changes searchText on the latest filters.
test('debounced search preserves filters changed while the timer was pending', () => {
  const atKeystroke = { searchText: '', categoryId: '', type: 'all' };
  const latest = { ...atKeystroke, categoryId: 'rent', type: 'expense' };
  assert.deepEqual(filtersWithSearchText(latest, 'coffee'), {
    searchText: 'coffee', categoryId: 'rent', type: 'expense',
  });
  assert.equal(latest.searchText, ''); // input is not mutated
});

test('debounced search emits nothing when the text is already current', () => {
  assert.equal(filtersWithSearchText({ searchText: '', type: 'all' }, ''), null); // mount
  assert.equal(filtersWithSearchText({ type: 'all' }, ''), null);
  assert.equal(filtersWithSearchText({ searchText: 'tea', type: 'all' }, 'tea'), null);
  assert.deepEqual(filtersWithSearchText({ searchText: 'tea', type: 'all' }, ''), { searchText: '', type: 'all' });
});
