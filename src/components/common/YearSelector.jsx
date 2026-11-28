import useAvailableYears from '../../hooks/useAvailableYears';
import { yearOptionsWithSelected } from '../../utils/reportRules';

const ARROW_CLASS =
  'rounded-lg border border-amber-200 bg-white p-2 text-stone-500 shadow-sm transition-all hover:bg-stone-50 hover:text-stone-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-amber-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-300';

/**
 * Year selector with arrow navigation and a dropdown, styled to match
 * MonthYearSelector.
 * @param {{ year: number, onChange: (year: number) => void }} props
 */
export default function YearSelector({ year, onChange }) {
  const { years: availableYears } = useAvailableYears();
  // Arrows can move past the available years; keep the selected one listed.
  const years = yearOptionsWithSelected(availableYears, year);

  return (
    <div className="flex items-center gap-3">
      <button type="button" onClick={() => onChange(year - 1)} className={ARROW_CLASS} aria-label="Previous year">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>

      <select
        value={year}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Year"
        className="rounded-xl border border-amber-300 bg-stone-50/50 px-3 py-2 text-sm font-medium text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>

      <button type="button" onClick={() => onChange(year + 1)} className={ARROW_CLASS} aria-label="Next year">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  );
}
