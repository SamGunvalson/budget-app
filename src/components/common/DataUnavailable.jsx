import { buttonClasses } from '../../utils/buttonClasses';

/**
 * Shown in place of figures when the data behind them could not be loaded.
 * Never substitute zeros for missing data — use this instead.
 */
export default function DataUnavailable({ eyebrow, title, message, onRetry, retrying = false, className = '' }) {
  return (
    <section
      role="status"
      className={`rounded-2xl border border-stone-200/60 bg-white p-6 shadow-sm dark:border-stone-700/60 dark:bg-stone-800 ${className}`}
    >
      {eyebrow && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500 dark:text-stone-400">{eyebrow}</p>
      )}
      <p className="mt-1.5 font-display text-2xl font-medium text-stone-900 dark:text-stone-100">{title}</p>
      {message && <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className={buttonClasses({ variant: 'secondary', size: 'sm', className: 'mt-4' })}
        >
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      )}
    </section>
  );
}
