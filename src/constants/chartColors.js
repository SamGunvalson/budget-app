/**
 * Shared neutrals for Recharts and category swatches.
 * Recharts takes colors as SVG attributes, so these are literal hex values
 * that mirror the re-tinted stone scale in src/index.css.
 */
export const CHART_GRID = '#dbdfd4'; // stone-200
export const CHART_AXIS = '#647167'; // stone-500
export const CHART_MUTED = '#949f95'; // stone-400
export const CHART_GOLD = '#eeb444'; // amber-500
export const CATEGORY_FALLBACK_COLOR = CHART_MUTED;
export const CHART_INCOME = '#10b981'; // emerald-500
// Spending series use the Reports accent (violet), not amber/orange, which
// mean "primary action" and "warning" in the Forest & Gold palette.
export const CHART_SPENDING = '#8b5cf6'; // violet-500
