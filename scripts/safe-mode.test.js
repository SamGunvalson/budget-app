import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  formatAxisDollar,
  formatCurrency,
  formatPreMaskedAxisDollar,
  formatPreMaskedDollars,
  maskAccountName,
  setSafeModeEnabled,
  toCents,
  toDateString,
  toDollars,
} from '../src/utils/helpers.js';

// A few seeds across the 0.4 – 2.5 range SafeModeProvider can produce.
const SEEDS = [0.4, 0.77, 1.3, 2.5];
const CENTS = [1, 99, 1250, 12345, 250000, 9876543, -1250, -250000];

afterEach(() => setSafeModeEnabled(false));

// ── RPT-4: chart values are masked once at build, never again at format ──

test('pre-masked chart label equals the single-masked formatCurrency value (safe mode on)', () => {
  for (const seed of SEEDS) {
    setSafeModeEnabled(true, seed);
    for (const cents of CENTS) {
      const plotted = toDollars(cents); // what the charts put in their data
      assert.equal(formatPreMaskedDollars(plotted), formatCurrency(cents), `seed ${seed}, cents ${cents}`);
    }
  }
});

test('pre-masked chart label is the real amount when safe mode is off', () => {
  setSafeModeEnabled(false);
  for (const cents of CENTS) {
    assert.equal(formatPreMaskedDollars(toDollars(cents)), formatCurrency(cents));
  }
  assert.equal(formatPreMaskedDollars(toDollars(123456)), '$1,234.56');
});

test('the old chart tooltip path masked twice; the pre-masked path does not', () => {
  setSafeModeEnabled(true, 1.3);
  const cents = 250000;
  const plotted = toDollars(cents);
  // Old tooltip: formatCurrency(Math.round(p.value * 100)) on an already-masked value.
  const doubleMasked = formatCurrency(Math.round(plotted * 100));
  assert.notEqual(doubleMasked, formatCurrency(cents));
  assert.equal(formatPreMaskedDollars(plotted), formatCurrency(cents));
});

test('pre-masked formatters never reveal the real amount in safe mode', () => {
  setSafeModeEnabled(true, 1.3);
  const cents = 250000;
  setSafeModeEnabled(false);
  const real = formatCurrency(cents);
  setSafeModeEnabled(true, 1.3);
  assert.notEqual(formatPreMaskedDollars(toDollars(cents)), real);
});

test('hideCents and absolute-value labels (PlanVsActualChart) match formatCurrency', () => {
  for (const enabled of [false, true]) {
    setSafeModeEnabled(enabled, 0.77);
    for (const cents of [250000, -250000, 12345]) {
      const plotted = toDollars(cents);
      // Scrambling preserves sign and is symmetric, so |mask(c)| === mask(|c|).
      assert.equal(
        formatPreMaskedDollars(Math.abs(plotted), 'USD', { hideCents: true }),
        formatCurrency(Math.abs(cents), 'USD', { hideCents: true }),
      );
      assert.equal(Math.sign(plotted), Math.sign(cents));
    }
  }
});

test('pre-masked axis formatter prints the tick as-is; formatAxisDollar would mask it again', () => {
  setSafeModeEnabled(true, 1.3);
  assert.equal(formatPreMaskedAxisDollar(1500), '$1,500');
  assert.notEqual(formatAxisDollar(1500), '$1,500');
  setSafeModeEnabled(false);
  assert.equal(formatPreMaskedAxisDollar(1500), '$1,500');
  assert.equal(formatAxisDollar(1500), '$1,500');
});

test('cashflow rule: compute in real cents, then mask the final value once', () => {
  // Mirrors CashflowChart: balance + playground offset summed in cents, then toDollars().
  const balanceCents = 100000;
  const offsetCents = -toCents(parseFloat('500.10'));
  const sumCents = balanceCents + offsetCents;
  assert.equal(sumCents, 49990);

  setSafeModeEnabled(false);
  assert.equal(toDollars(sumCents), 499.9);

  setSafeModeEnabled(true, 0.4);
  const plotted = toDollars(sumCents);
  assert.equal(formatPreMaskedDollars(plotted), formatCurrency(sumCents));
  // The sign of the real result survives masking, so negative-balance
  // regions are detected from the real balance, not a scrambled mix.
  assert.ok(plotted > 0);
  assert.ok(toDollars(balanceCents - 150000) < 0);
});

// ── RPT-6: unfocused budget cell shows the masked whole-dollar value ──

test('budget cell display value is masked once in safe mode and raw otherwise', () => {
  const cents = 123456;
  const display = () => String(Math.round(toDollars(cents)));
  const raw = String(Math.round(toDollars(cents, { raw: true })));

  setSafeModeEnabled(false);
  assert.equal(display(), '1235');
  assert.equal(display(), raw);

  setSafeModeEnabled(true, 2.5);
  assert.notEqual(display(), raw);
  // The edit value stays real so a focus/blur never writes a scrambled amount.
  assert.equal(toDollars(cents, { raw: true }).toFixed(2), '1234.56');
});

// ── RPT-5 / UI-11: money hints go through formatCurrency on integer cents ──

test('split and transfer hints: formatCurrency on integer cents, masked only in safe mode', () => {
  setSafeModeEnabled(false);
  assert.equal(formatCurrency(Math.floor(2501 / 2)), '$12.50');
  // 0.3 - 0.1 is 0.19999999999999998 in float maths; cents maths is exact.
  assert.equal(formatCurrency(toCents(0.3) - toCents(0.1)), '$0.20');
  assert.equal(formatCurrency(toCents(parseFloat('1000.10')) - toCents(parseFloat('999.95'))), '$0.15');

  setSafeModeEnabled(true, 2.5);
  assert.notEqual(formatCurrency(123456), '$1,234.56');
});

// ── RPT-7 / RPT-8 / APP-13: names are masked at render, not cached ──

test('account names masked at render follow the safe-mode flag', () => {
  const item = { account: 'Chase Checking', toAccount: 'Ally Savings' }; // raw, as stored in the memo

  setSafeModeEnabled(false);
  assert.equal(maskAccountName(item.account), 'Chase Checking');

  setSafeModeEnabled(true, 1.3);
  const masked = maskAccountName(item.account);
  assert.match(masked, /^Account [A-Z]\d*$/);
  assert.notEqual(maskAccountName(item.toAccount), masked);
  assert.equal(maskAccountName(item.account), masked); // stable within a session

  setSafeModeEnabled(false);
  assert.equal(maskAccountName(item.account), 'Chase Checking');
});

// ── APP-13: default projected date is built from local calendar parts ──

test('today + 30 days via local parts is exactly 30 local days ahead', () => {
  const base = new Date(2026, 0, 31, 23, 30); // late evening local time
  const d = new Date(base);
  d.setDate(d.getDate() + 30);
  assert.equal(toDateString(d), '2026-03-02');
  const parsed = new Date(`${toDateString(d)}T00:00:00`);
  const startOfBase = new Date(2026, 0, 31);
  assert.equal(Math.round((parsed - startOfBase) / 86400000), 30);
});
