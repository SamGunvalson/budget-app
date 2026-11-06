import assert from 'node:assert/strict';
import { test } from 'node:test';
import { centsToInput, evaluateAmount } from '../src/utils/calculator.js';

test('arithmetic is exact and rounds only the final cents', () => {
  for (const [expression, expected] of [
    ['3+3', 600], ['2+3*4', 1400], ['(2+3)*4', 2000],
    ['0.1+0.2', 30], ['10/3', 333], ['1.005', 101],
    ['1/3*3', 100], ['.004+.004', 1], ['.004', 0],
    ['-3 + +6', 300], ['2*-3+10', 400], ['--3', 300],
    [' 2 × (9 − 3) ÷ 4 ', 300], ['1.', 100], ['.5', 50],
    ['0/2', 0], ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ]) {
    assert.deepEqual(evaluateAmount(expression), { cents: expected, error: '' }, expression);
  }
});

test('invalid or disallowed results never return applicable cents', () => {
  for (const expression of [
    '', ' ', '3+', '()', '(3', '3)', '1/0', '0/0', '1/(3-3)',
    '2(3)', '2**3', '1e3', '10%', '=3+3', 'Math.random()', 'Infinity',
    '1;2', '1..2', '1,000', '-.001', '90071992547409.92', '90071992547409.90',
    '1+'.repeat(128) + '1', '('.repeat(34) + '1' + ')'.repeat(34),
    '-'.repeat(34) + '1',
  ]) {
    const result = evaluateAmount(expression);
    assert.equal(result.cents, null, expression);
    assert.ok(result.error, expression);
  }
  assert.equal(evaluateAmount('0', { minCents: 1 }).cents, null);
  assert.equal(evaluateAmount('.004', { minCents: 1 }).cents, null);
  assert.equal(evaluateAmount('.005', { minCents: 1 }).cents, 1);
  assert.equal(evaluateAmount('0').cents, 0);
});

test('cents input formatting round-trips without floating-point loss', () => {
  for (const cents of [0, 1, 333, 600, 1000001, Number.MAX_SAFE_INTEGER]) {
    assert.equal(evaluateAmount(centsToInput(cents)).cents, cents);
  }
  assert.equal(centsToInput(333), '3.33');
  assert.equal(centsToInput(-1), '-0.01');
  assert.throws(() => centsToInput(1.5));
});
