// Pure decision rules for the transaction form, inline row editing and the
// filter bar. Kept free of React and browser APIs so they can be unit tested.

/**
 * Inline amount cells hold dollars as typed by the user and are stored as
 * positive integer cents (`is_income` carries the direction). The database
 * rejects a zero amount, so an edit is only acceptable when it is a finite
 * number above zero that does not round down to zero cents.
 */
export function isValidInlineAmount(input) {
  if (input == null || String(input).trim() === '') return false;
  const dollars = Number(input);
  return Number.isFinite(dollars) && dollars > 0 && Math.round(dollars * 100) >= 1;
}

/** A real calendar date in YYYY-MM-DD form (what `<input type="date">` emits). */
export function isValidInlineDate(input) {
  if (typeof input !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Whether an inline cell edit may be queued; other cell types are unrestricted. */
export function isValidInlineEdit(type, draft) {
  if (type === 'number') return isValidInlineAmount(draft);
  if (type === 'date') return isValidInlineDate(draft);
  return true;
}

/**
 * The "amount applied to account" field is only rendered for a transfer with a
 * destination account, or an expense/income with a linked account.
 */
export function isToAmountFieldVisible({ transactionType, toAccountId, linkedAccountId }) {
  return transactionType === 'transfer' ? Boolean(toAccountId) : Boolean(linkedAccountId);
}

/**
 * Error message for the "amount applied to account" field, or null. A hidden
 * field is never validated: its error could not be shown and its value is not
 * submitted.
 */
export function toAmountForAccountError({ visible, toAmountForAccount, amount }) {
  if (!visible || toAmountForAccount === '') return null;
  const toAmount = parseFloat(toAmountForAccount);
  if (isNaN(toAmount) || toAmount <= 0) return 'Amount must be greater than 0.';
  const total = parseFloat(amount);
  if (!isNaN(total) && toAmount > total) return 'Cannot exceed the total payment amount.';
  return null;
}

function categoryMatchesTransactionType(category, transactionType) {
  if (transactionType === 'transfer') return category.type === 'transfer';
  if (transactionType === 'income') return category.type === 'income';
  return category.type !== 'transfer' && category.type !== 'income';
}

/**
 * Category to select after the transaction type changes: keep the current one
 * when it matches the new type, otherwise the first that does. Falls back to
 * the first selectable category for the type when none matches exactly.
 */
export function categoryIdForTransactionType(categories, currentCategoryId, transactionType) {
  const matching = categories.filter((c) => categoryMatchesTransactionType(c, transactionType));
  if (currentCategoryId && matching.some((c) => c.id === currentCategoryId)) return currentCategoryId;
  if (matching.length > 0) return matching[0].id;
  const selectable = transactionType === 'transfer'
    ? []
    : categories.filter((c) => c.type !== 'transfer');
  return selectable[0]?.id || '';
}

/**
 * Filters to emit when the debounced search text settles, built from the
 * latest filters so a filter changed during the debounce is preserved.
 * Returns null when the search text is already current (e.g. on mount).
 */
export function filtersWithSearchText(latestFilters, searchText) {
  if ((latestFilters.searchText || '') === searchText) return null;
  return { ...latestFilters, searchText };
}
