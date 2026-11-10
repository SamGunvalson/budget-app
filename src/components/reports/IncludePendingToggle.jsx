/**
 * Compact switch controlling whether reports count projected, pending, and
 * future-dated transactions. Off by default so reports show settled
 * activity only; see `isSettledTransaction` in utils/helpers.
 *
 * @param {{ checked: boolean, onChange: (next: boolean) => void }} props
 */
export default function IncludePendingToggle({ checked, onChange }) {
  return (
    <label
      className="inline-flex cursor-pointer select-none items-center gap-2 rounded-xl border border-stone-200/60 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 shadow-sm dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-400"
      title="Include projected, pending, and future-dated transactions in report totals"
    >
      <span>Include upcoming</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="Include upcoming transactions"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 dark:focus:ring-offset-stone-800 ${
          checked ? 'bg-violet-500' : 'bg-stone-300 dark:bg-stone-600'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}
