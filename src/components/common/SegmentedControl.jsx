const SIZE_CLASSES = {
  md: 'px-4 py-1.5 text-sm',
  sm: 'px-3 py-1.5 text-xs sm:text-sm',
};

/**
 * Segmented control (view tabs, Monthly / YTD, ranges). The selected segment
 * is ink, never gold or a per-view color (STYLE_GUIDE → Segmented controls).
 *
 * @param {{
 *   options: Array<{ value: string, label: string, shortLabel?: string }>,
 *   value: string,
 *   onChange: (value: string) => void,
 *   size?: 'md' | 'sm',
 *   ariaLabel?: string,
 *   className?: string,
 * }} props
 * `shortLabel` replaces `label` below the `sm` breakpoint.
 */
export default function SegmentedControl({ options, value, onChange, size = 'md', ariaLabel, className = '' }) {
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`no-scrollbar inline-flex max-w-full overflow-x-auto rounded-xl border border-stone-200/60 bg-stone-50 p-1 shadow-sm dark:border-stone-700/60 dark:bg-stone-700/30 ${className}`}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.shortLabel ? opt.label : undefined}
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={`flex-1 whitespace-nowrap rounded-lg font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 sm:flex-none ${sizeClass} ${
              selected
                ? 'bg-stone-900 text-stone-50 shadow-sm dark:bg-stone-100 dark:text-stone-900'
                : 'text-stone-500 hover:bg-white hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-600 dark:hover:text-stone-200'
            }`}
          >
            {opt.shortLabel ? (
              <>
                <span className="sm:hidden">{opt.shortLabel}</span>
                <span className="hidden sm:inline">{opt.label}</span>
              </>
            ) : (
              opt.label
            )}
          </button>
        );
      })}
    </div>
  );
}
