import { formatCurrency } from './helpers';

// ── Default thresholds (user-configurable via Settings) ──
export const BUDGET_UNDER_BUDGET_THRESHOLD = 80; // percent
export const BUDGET_WARNING_THRESHOLD = 100; // percent
export const BUDGET_DANGER_THRESHOLD = 110; // percent

/** Convenient object form of the defaults. */
export const DEFAULT_THRESHOLDS = {
  underBudget: BUDGET_UNDER_BUDGET_THRESHOLD,
  warning: BUDGET_WARNING_THRESHOLD,
  danger: BUDGET_DANGER_THRESHOLD,
};

/**
 * Calculate percent of budget used.
 * @param {number} actual  - Amount spent (cents)
 * @param {number} planned - Budgeted amount (cents)
 * @returns {number} Percentage (0-Infinity). Returns 0 when both are 0.
 */
export function percentUsed(actual, planned) {
  if (planned <= 0) return actual > 0 ? Infinity : 0;
  return (actual / planned) * 100;
}

/**
 * Calculate variance (actual − planned). Positive = over budget.
 * @param {number} actual  - Amount spent (cents)
 * @param {number} planned - Budgeted amount (cents)
 * @returns {number} Variance in cents (positive = over, negative = under)
 */
export function variance(actual, planned) {
  return actual - planned;
}

/**
 * Format a variance as a human-friendly string.
 * @param {number} varianceCents - Variance in cents (positive = over)
 * @returns {string} e.g. "$75 over budget" or "$100 under budget"
 */
export function formatVariance(varianceCents) {
  if (varianceCents === 0) return 'On budget';
  const abs = Math.abs(varianceCents);
  const direction = varianceCents > 0 ? 'over budget' : 'under budget';
  return `${formatCurrency(abs)} ${direction}`;
}

/**
 * Determine alert level based on percent used.
 * Accepts optional custom thresholds; falls back to defaults.
 * @param {number} pct - Percent used (from percentUsed())
 * @param {{ underBudget?: number, warning?: number, danger?: number }} [thresholds]
 * @returns {'danger' | 'warning' | 'success' | 'underBudget'} Alert level
 */
export function alertLevel(pct, thresholds) {
  const dangerAt = thresholds?.danger ?? BUDGET_DANGER_THRESHOLD;
  const warningAt = thresholds?.warning ?? BUDGET_WARNING_THRESHOLD;
  const underBudgetAt = thresholds?.underBudget ?? BUDGET_UNDER_BUDGET_THRESHOLD;
  if (pct >= dangerAt) return 'danger';
  if (pct >= warningAt) return 'warning';
  if (pct < underBudgetAt) return 'underBudget';
  return 'success';
}

/**
 * Return an icon string for the alert level.
 * @param {'danger' | 'warning' | 'success'} level
 * @returns {string} Emoji/icon
 */
export function alertIcon(level) {
  switch (level) {
    case 'danger':
      return '🔴';
    case 'warning':
      return '⚠️';
    case 'underBudget':
      return '🟢';
    default:
      return '✅';
  }
}

/**
 * Build a complete alert descriptor for one category row.
 * @param {{ planned: number, actual: number, categoryName?: string }} item
 * @param {{ warning?: number, danger?: number }} [thresholds]
 * @returns {{
 *   pct: number,
 *   varianceCents: number,
 *   varianceText: string,
 *   level: 'danger' | 'warning' | 'success',
 *   icon: string,
 * }}
 */
export function categoryAlert(item, thresholds) {
  const pct = percentUsed(item.actual, item.planned);
  const v = variance(item.actual, item.planned);
  const level = alertLevel(pct, thresholds);
  return {
    pct: pct === Infinity ? Infinity : Math.round(pct),
    varianceCents: v,
    varianceText: formatVariance(v),
    level,
    icon: alertIcon(level),
  };
}

/**
 * Filter an array of plan-vs-actual rows to only those that need alerts
 * (at or above the warning threshold).
 * @param {Array<{ planned: number, actual: number }>} data
 * @param {{ warning?: number, danger?: number }} [thresholds]
 * @returns {Array<Object>} Rows with alert info attached
 */
export function flaggedCategories(data, thresholds) {
  return data
    .filter((d) => d.planned > 0)
    .map((d) => ({ ...d, alert: categoryAlert(d, thresholds) }))
    .filter((d) => d.alert.level !== 'success')
    .sort((a, b) => (b.alert.pct === Infinity ? 1 : b.alert.pct) - (a.alert.pct === Infinity ? 1 : a.alert.pct));
}

/**
 * Build an overall (total) alert from aggregated planned/actual amounts.
 * @param {number} totalActual  - Total actual spending (cents)
 * @param {number} totalPlanned - Total planned budget (cents)
 * @param {{ warning?: number, danger?: number }} [thresholds]
 * @returns {{ pct: number, varianceCents: number, varianceText: string, level: string, icon: string }}
 */
export function overallAlert(totalActual, totalPlanned, thresholds) {
  const pct = percentUsed(totalActual, totalPlanned);
  const v = variance(totalActual, totalPlanned);
  const level = alertLevel(pct, thresholds);
  return {
    pct: pct === Infinity ? Infinity : Math.round(pct),
    varianceCents: v,
    varianceText: formatVariance(v),
    level,
    icon: alertIcon(level),
  };
}

/**
 * Calculate projected spend by including pending transactions on top of posted actuals.
 * Projected transactions (status='projected') are intentionally excluded because they
 * are too far out and not yet "real" enough for budget variance tracking.
 *
 * @param {Array<{ amount: number, status?: string, is_income?: boolean, categories?: { type?: string } }>} transactions
 * @returns {{ postedSpend: number, pendingSpend: number, projectedSpend: number }}
 *   - postedSpend: sum of posted expense amounts (cents, positive = spent)
 *   - pendingSpend: sum of pending expense amounts (cents, positive = spent)
 *   - projectedSpend: postedSpend + pendingSpend
 */
export function projectedSpend(transactions) {
  let postedSpend = 0;
  let pendingSpend = 0;

  for (const t of transactions) {
    // Skip transfers and income
    if (t.categories?.type === 'transfer') continue;
    if (t.is_income) continue;

    const amt = Math.abs(t.amount);
    const status = t.status || 'posted';

    if (status === 'posted') {
      postedSpend += amt;
    } else if (status === 'pending') {
      pendingSpend += amt;
    }
    // 'projected' intentionally ignored for budget calculations
  }

  return {
    postedSpend,
    pendingSpend,
    projectedSpend: postedSpend + pendingSpend,
  };
}
