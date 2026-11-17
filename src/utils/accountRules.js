// Pure account rules shared by the account service and offline wrappers.
// No imports, so tests and the offline layer can load it directly.

/** Statement-cycle columns on `accounts` (credit card settlement settings). */
export const STATEMENT_CYCLE_FIELDS = [
  "statement_close_day",
  "payment_due_day",
  "payment_account_id",
];

function normalizeCycleDay(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const day = Number(value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`${field} must be a whole number from 1 to 31.`);
  }
  return day;
}

/**
 * Normalize statement-cycle fields from a form or payload. Only fields present
 * in `values` are returned, so partial updates leave the others untouched.
 * Blank values become null; days must be 1-31; an account cannot pay itself.
 *
 * @param {Object} values
 * @param {string} [accountId] — the account being saved, for the self check
 * @returns {{ statement_close_day?: number|null, payment_due_day?: number|null, payment_account_id?: string|null }}
 */
export function normalizeStatementCycle(values = {}, accountId) {
  const out = {};
  if (values.statement_close_day !== undefined) {
    out.statement_close_day = normalizeCycleDay(values.statement_close_day, "Statement close day");
  }
  if (values.payment_due_day !== undefined) {
    out.payment_due_day = normalizeCycleDay(values.payment_due_day, "Payment due day");
  }
  if (values.payment_account_id !== undefined) {
    const payer = values.payment_account_id || null;
    if (payer && accountId && payer === accountId) {
      throw new Error("An account cannot pay its own statement.");
    }
    out.payment_account_id = payer;
  }
  return out;
}
