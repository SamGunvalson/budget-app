import { getMonthName } from '../../utils/helpers';
import useAvailableYears from '../../hooks/useAvailableYears';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const ACCENT_CLASSES = {
  amber: {
    btnBorder: 'border-amber-200 dark:border-amber-700',
    btnFocus: 'focus:ring-amber-500',
    selectBorder: 'border-amber-300 dark:border-amber-600',
    selectFocus: 'focus:ring-amber-500',
  },
  emerald: {
    btnBorder: 'border-emerald-200 dark:border-emerald-700',
    btnFocus: 'focus:ring-emerald-500',
    selectBorder: 'border-emerald-300 dark:border-emerald-600',
    selectFocus: 'focus:ring-emerald-500',
  },
  sky: {
    btnBorder: 'border-sky-200 dark:border-sky-700',
    btnFocus: 'focus:ring-sky-500',
    selectBorder: 'border-sky-300 dark:border-sky-600',
    selectFocus: 'focus:ring-sky-500',
  },
};

/**
 * Month/year selector with arrow navigation and dropdown fallback.
 * @param {{ month: number, year: number, onChange: (m: number, y: number) => void, accent?: 'amber' | 'emerald' | 'sky' }} props
 */
export default function MonthYearSelector({ month, year, onChange, accent = 'amber' }) {
  const a = ACCENT_CLASSES[accent] ?? ACCENT_CLASSES.amber;
  const goBack = () => {
    if (month === 1) onChange(12, year - 1);
    else onChange(month - 1, year);
  };

  const goForward = () => {
    if (month === 12) onChange(1, year + 1);
    else onChange(month + 1, year);
  };

  const { years } = useAvailableYears();

  return (
    <div className="flex items-center gap-3">
      {/* Back arrow */}
      <button
        type="button"
        onClick={goBack}
        className={`rounded-lg border ${a.btnBorder} bg-white p-2 text-stone-500 shadow-sm transition-all hover:bg-stone-50 hover:text-stone-700 hover:shadow-md focus:outline-none focus:ring-2 ${a.btnFocus} focus:ring-offset-2 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-300`}
        aria-label="Previous month"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>

      {/* Month select */}
      <select
        value={month}
        onChange={(e) => onChange(Number(e.target.value), year)}
        className={`rounded-xl border ${a.selectBorder} bg-stone-50/50 px-3 py-2 text-sm font-medium text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 ${a.selectFocus} dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700`}
      >
        {MONTHS.map((m) => (
          <option key={m} value={m}>
            {getMonthName(m)}
          </option>
        ))}
      </select>

      {/* Year select */}
      <select
        value={year}
        onChange={(e) => onChange(month, Number(e.target.value))}
        className={`rounded-xl border ${a.selectBorder} bg-stone-50/50 px-3 py-2 text-sm font-medium text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 ${a.selectFocus} dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700`}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      {/* Forward arrow */}
      <button
        type="button"
        onClick={goForward}
        className={`rounded-lg border ${a.btnBorder} bg-white p-2 text-stone-500 shadow-sm transition-all hover:bg-stone-50 hover:text-stone-700 hover:shadow-md focus:outline-none focus:ring-2 ${a.btnFocus} focus:ring-offset-2 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-300`}
        aria-label="Next month"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  );
}
