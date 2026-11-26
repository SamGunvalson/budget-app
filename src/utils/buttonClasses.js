/**
 * Shared button styles. Gold (`primary`) is for the one main action on a
 * screen; everything else is `secondary`, `ghost`, or `danger`.
 * See docs/STYLE_GUIDE.md → Buttons.
 */
const BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-stone-900 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100';

const VARIANTS = {
  primary:
    'bg-amber-500 text-stone-950 shadow-md shadow-amber-200/50 hover:bg-amber-600 hover:shadow-lg focus-visible:ring-amber-500 dark:shadow-amber-900/30',
  secondary:
    'border border-stone-200 bg-white text-stone-700 shadow-sm hover:bg-stone-50 hover:shadow-md focus-visible:ring-amber-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700',
  ghost:
    'text-stone-600 hover:bg-stone-100 hover:text-stone-900 focus-visible:ring-amber-500 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100',
  danger:
    'bg-red-500 text-white shadow-md shadow-red-200/50 hover:bg-red-600 hover:shadow-lg focus-visible:ring-red-500 dark:shadow-red-900/30',
};

const SIZES = {
  sm: 'px-3.5 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
};

export function buttonClasses({ variant = 'secondary', size = 'md', className = '' } = {}) {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim();
}
