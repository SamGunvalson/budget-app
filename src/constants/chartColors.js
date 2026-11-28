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
 * Multi-series report charts. The category TYPE_COLORS are too close to tell
 * apart in a chart (needs coral vs wants rose: ΔE 4 even with full color
 * vision), so stacked type charts use these instead. Each set passed the
 * dataviz palette validator (lightness band, chroma floor, CVD and
 * normal-vision separation, contrast) on both the light (#fffefa) and dark
 * (#202722) panel surfaces, in the order listed (adjacent stack order).
 */
export const MIX_COLORS = {
  needs: TYPE_COLORS.needs, // coral #c46a6a
  wants: SERIES_COLORS[5], // indigo #5c6bc0
  saved: TYPE_COLORS.income, // jade #3d9a6e
  leftOver: SERIES_COLORS[0], // blue #4f86c6
};
export const FIXED_FLEX_COLORS = {
  fixed: SERIES_COLORS[4], // olive #7a8f3a
  flexible: CHART_SPENDING, // violet: flexible is the spending you steer
};
// Bar spacer: a 2px surface-colored stroke separates stacked segments.
export const CHART_SURFACE = 'var(--app-panel)';
