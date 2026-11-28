/**
 * Category-type styling shared by Budgets, Categories and Reports. One source,
 * so a type's dot, group header and default category color always agree with
 * TYPE_COLORS in ./palette.js.
 *
 * Income jade (emerald-500), Needs ochre (amber-700), Wants orchid
 * (fuchsia-500), Savings blue (blue-500). This is the only set of palette
 * shades that passed the dataviz palette validator with ALL pairs compared
 * (dots appear side by side in lists), in both themes: the previous needs
 * coral / wants rose pair was ΔE 4 apart even with full color vision, and
 * green income vs red-toned needs collapsed for red-green colorblind readers.
 * Separation is in the CVD floor band, so a type color is always shown with
 * its name, never alone.
 */

/** Dot / swatch background for each type. */
export const TYPE_DOT_CLASSES = {
  income: 'bg-emerald-500',
  needs: 'bg-amber-700',
  wants: 'bg-fuchsia-500',
  savings: 'bg-blue-500',
  transfer: 'bg-stone-400',
  other: 'bg-stone-400',
};

/** Tinted group-header bands in the annual grids. */
export const TYPE_HEADER_STYLES = {
  income: {
    label: 'Income',
    headerBg: 'bg-emerald-50 dark:bg-emerald-900/30',
    stickyBg: 'bg-emerald-50 dark:bg-emerald-950',
    headerText: 'text-emerald-800 dark:text-emerald-300',
    headerBorder: 'border-emerald-200/60 dark:border-emerald-700/60',
  },
  needs: {
    label: 'Needs',
    headerBg: 'bg-amber-50 dark:bg-amber-900/30',
    stickyBg: 'bg-amber-50 dark:bg-amber-950',
    headerText: 'text-amber-800 dark:text-amber-300',
    headerBorder: 'border-amber-200/60 dark:border-amber-700/60',
  },
  wants: {
    label: 'Wants',
    headerBg: 'bg-fuchsia-50 dark:bg-fuchsia-900/30',
    stickyBg: 'bg-fuchsia-50 dark:bg-fuchsia-950',
    headerText: 'text-fuchsia-800 dark:text-fuchsia-300',
    headerBorder: 'border-fuchsia-200/60 dark:border-fuchsia-700/60',
  },
  savings: {
    label: 'Savings',
    headerBg: 'bg-blue-50 dark:bg-blue-900/30',
    stickyBg: 'bg-blue-50 dark:bg-blue-950',
    headerText: 'text-blue-800 dark:text-blue-300',
    headerBorder: 'border-blue-200/60 dark:border-blue-700/60',
  },
};
