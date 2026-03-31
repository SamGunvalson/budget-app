import { useState } from 'react';
import { formatCurrency } from '../../utils/helpers';

/**
 * Visual alert banner for budget status.
 * Shows a red (danger), amber (warning), or green (success) alert.
 *
 * @param {{
 *   type?: 'danger' | 'warning' | 'success',
 *   title: string,
 *   message?: string,
 *   actual?: number,
 *   planned?: number,
 *   varianceText?: string,
 *   className?: string,
 * }} props
 */
export default function BudgetAlert({
  type = 'danger',
  title,
  message,
  actual,
  planned,
  varianceText,
  className = '',
}) {
  const styles = {
    danger: {
      container: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950',
      icon: 'text-red-500 dark:text-red-400',
      title: 'text-red-800 dark:text-red-300',
      message: 'text-red-600 dark:text-red-400',
      badge: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
    },
    warning: {
      container: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950',
      icon: 'text-amber-500 dark:text-amber-400',
      title: 'text-amber-800 dark:text-amber-300',
      message: 'text-amber-600 dark:text-amber-400',
      badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
    },
    underBudget: {
      container: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950',
      icon: 'text-emerald-500 dark:text-emerald-400',
      title: 'text-emerald-800 dark:text-emerald-300',
      message: 'text-emerald-600 dark:text-emerald-400',
      badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    },
    success: {
      container: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950',
      icon: 'text-emerald-500 dark:text-emerald-400',
      title: 'text-emerald-800 dark:text-emerald-300',
      message: 'text-emerald-600 dark:text-emerald-400',
      badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
    },
  };

  const s = styles[type] || styles.danger;

  const showAmounts =
    actual !== undefined && planned !== undefined && planned > 0;
  const [detailOpen, setDetailOpen] = useState(false);

  return (
    <div
      className={`animate-fade-in flex items-start gap-3 rounded-xl border px-4 py-3 ${s.container} ${className}`}
      role="alert"
    >
      {/* Alert icon */}
      <div className="mt-0.5 flex-shrink-0">
        {type === 'danger' ? (
          <svg
            className={`h-5 w-5 ${s.icon}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
            />
          </svg>
        ) : type === 'warning' ? (
          <svg
            className={`h-5 w-5 ${s.icon}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        ) : (
          <svg
            className={`h-5 w-5 ${s.icon}`}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`flex-1 text-sm font-semibold ${s.title}`}>{title}</p>
          {varianceText && (
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${s.badge}`}
            >
              {varianceText}
            </span>
          )}
          {(message || showAmounts) && (
            <button
              type="button"
              onClick={() => setDetailOpen((d) => !d)}
              aria-label={detailOpen ? 'Hide details' : 'Show details'}
              className={`sm:hidden shrink-0 rounded-full p-0.5 transition-opacity hover:opacity-70 ${s.icon}`}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z"
                />
              </svg>
            </button>
          )}
        </div>
        <div className={`${detailOpen ? '' : 'hidden'} sm:block`}>
          {message && (
            <p className={`mt-0.5 text-sm ${s.message}`}>{message}</p>
          )}
          {showAmounts && (
            <p className={`mt-0.5 text-xs ${s.message}`}>
              {formatCurrency(actual)} spent of {formatCurrency(planned)} planned
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
