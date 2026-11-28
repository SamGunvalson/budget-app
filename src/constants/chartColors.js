/**
 * Shared colors for Recharts and category swatches.
 * Recharts takes colors as SVG attributes, so these are literal hex values
 * that mirror the re-tinted scales in src/index.css (see ./palette.js).
 */
import { SERIES_COLORS, TYPE_COLORS } from './palette';

export { SERIES_COLORS };

export const CHART_GRID = '#dbdfd4'; // stone-200
export const CHART_AXIS = '#647167'; // stone-500
export const CHART_MUTED = '#949f95'; // stone-400
export const CHART_GOLD = '#eeb444'; // amber-500
export const CATEGORY_FALLBACK_COLOR = CHART_MUTED;
export const CHART_INCOME = TYPE_COLORS.income; // emerald-500 (jade)
// Spending series use the Reports accent (violet), not amber/orange, which
// mean "primary action" and "warning" in the Forest & Gold palette.
export const CHART_SPENDING = '#8b6fc0'; // violet-500
// Over budget / negative net keeps the error red.
export const CHART_NEGATIVE = '#ef4444'; // red-500

/*
 * Multi-series report charts. Type series use the category TYPE_COLORS (see
 * constants/typeStyles.js for how they were validated); `leftOver` (Overview's
 * "Left in checking") is olive, which passed after blue savings in stack order
 * on both panel surfaces (#fffefa light, #202722 dark).
 */
export const MIX_COLORS = {
  needs: TYPE_COLORS.needs, // ochre #8f5f16
  wants: TYPE_COLORS.wants, // orchid #a86495
  saved: TYPE_COLORS.savings, // blue #4f86c6
  leftOver: SERIES_COLORS[4], // olive #7a8f3a
};
export const FIXED_FLEX_COLORS = {
  fixed: SERIES_COLORS[4], // olive #7a8f3a
  flexible: CHART_SPENDING, // violet: flexible is the spending you steer
};
// Bar spacer: a 2px surface-colored stroke separates stacked segments.
export const CHART_SURFACE = 'var(--app-panel)';
