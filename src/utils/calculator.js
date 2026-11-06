// Bound parsing work and BigInt growth, including expressions that later cancel.
const MAX_LENGTH = 256;
const MAX_DEPTH = 32;
const MAX_DIGITS = 512;
class CalculationError extends Error {}

function fraction(n, d = 1n) {
  if (d === 0n) throw new CalculationError('Cannot divide by zero.');
  if (n.toString().length > MAX_DIGITS || d.toString().length > MAX_DIGITS) {
    throw new CalculationError('Calculation is too large.');
  }
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n;
  let b = d;
  while (b) [a, b] = [b, a % b];
  return { n: n / a, d: d / a };
}

export function centsToInput(cents) {
  if (!Number.isSafeInteger(cents)) throw new Error('Amount is outside the supported range.');
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function evaluateAmount(expression, { minCents = 0 } = {}) {
  try {
    if (expression.length > MAX_LENGTH) throw new CalculationError('Use at most 256 characters.');
    const text = expression.replaceAll('×', '*').replaceAll('÷', '/').replaceAll('−', '-');
    let position = 0;
    const skip = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
    const take = (char) => {
      skip();
      if (text[position] !== char) return false;
      position++;
      return true;
    };
    function primary(depth) {
      if (depth > MAX_DEPTH) throw new CalculationError('Use at most 32 nested parentheses or signs.');
      if (take('+')) return primary(depth + 1);
      if (take('-')) {
        const value = primary(depth + 1);
        return fraction(-value.n, value.d);
      }
      if (take('(')) {
        const value = sum(depth + 1);
        if (!take(')')) throw new CalculationError('Close each parenthesis.');
        return value;
      }
      skip();
      const match = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(text.slice(position));
      if (!match) throw new CalculationError('Enter a number or parenthesized calculation.');
      position += match[0].length;
      const [whole, decimal = ''] = match[0].split('.');
      return fraction(BigInt((whole || '0') + decimal), 10n ** BigInt(decimal.length));
    }
    function product(depth) {
      let left = primary(depth);
      while (true) {
        if (take('*')) {
          const right = primary(depth);
          left = fraction(left.n * right.n, left.d * right.d);
        } else if (take('/')) {
          const right = primary(depth);
          left = fraction(left.n * right.d, left.d * right.n);
        } else return left;
      }
    }
    function sum(depth) {
      let left = product(depth);
      while (true) {
        if (take('+')) {
          const right = product(depth);
          left = fraction(left.n * right.d + right.n * left.d, left.d * right.d);
        } else if (take('-')) {
          const right = product(depth);
          left = fraction(left.n * right.d - right.n * left.d, left.d * right.d);
        } else return left;
      }
    }
    if (!text.trim()) return { cents: null, error: 'Enter a calculation.' };
    const value = sum(0);
    skip();
    if (position !== text.length) throw new CalculationError('Use only numbers, +, -, *, /, and parentheses.');
    if (value.n < 0n) throw new CalculationError('Amount cannot be negative.');
    const scaled = value.n * 100n;
    const rounded = scaled / value.d + (scaled % value.d * 2n >= value.d ? 1n : 0n);
    if (rounded > BigInt(Number.MAX_SAFE_INTEGER)) throw new CalculationError('Amount is outside the supported range.');
    const cents = Number(rounded);
    // Existing form saves parse dollar strings; reject amounts that lose cents on that path.
    if (Math.round(Number(centsToInput(cents)) * 100) !== cents) throw new CalculationError('Amount is outside the supported range.');
    if (cents < minCents) throw new CalculationError(minCents === 1 ? 'Amount must be at least $0.01.' : 'Amount is below the allowed minimum.');
    return { cents, error: '' };
  } catch (error) {
    if (!(error instanceof CalculationError)) throw error;
    return { cents: null, error: error.message };
  }
}
