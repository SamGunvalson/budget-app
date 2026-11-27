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
