import { useState } from 'react';
import {
  exportTransactionsCSV,
  exportBudgetCSV,
  exportFullBackupJSON,
} from '../../services/export';

const EXPORT_OPTIONS = [
  {
    id: 'transactions',
    label: 'Transactions (CSV)',
    description: 'All transactions with date, description, category, and amount. Opens in Excel.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M12 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125" />
      </svg>
    ),
    iconBg: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  {
    id: 'budgets',
    label: 'Budget History (CSV)',
    description: 'Monthly budgets with planned vs actual amounts per category.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z" />
      </svg>
    ),
    iconBg: 'bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  },
  {
    id: 'backup',
    label: 'Full Backup (JSON)',
    description: 'Complete data export — categories, accounts, transactions, budgets, and recurring templates.',
    icon: (
      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
    iconBg: 'bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  },
];

export default function ExportData() {
  const [exporting, setExporting] = useState(null); // id of currently exporting option
  const [result, setResult] = useState(null); // { id, success, message }

  const handleExport = async (id) => {
    setExporting(id);
    setResult(null);

    try {
      let count;
      switch (id) {
        case 'transactions':
          count = await exportTransactionsCSV();
          setResult({ id, success: true, message: `Exported ${count} transaction${count !== 1 ? 's' : ''}.` });
          break;
        case 'budgets':
          count = await exportBudgetCSV();
          setResult({ id, success: true, message: `Exported ${count} budget row${count !== 1 ? 's' : ''}.` });
          break;
        case 'backup': {
          const stats = await exportFullBackupJSON();
          const parts = [];
          if (stats.categories) parts.push(`${stats.categories} categories`);
          if (stats.accounts) parts.push(`${stats.accounts} accounts`);
          if (stats.transactions) parts.push(`${stats.transactions} transactions`);
          if (stats.budgetPlans) parts.push(`${stats.budgetPlans} budget plans`);
          if (stats.recurringTemplates) parts.push(`${stats.recurringTemplates} templates`);
          setResult({ id, success: true, message: `Backup complete — ${parts.join(', ')}.` });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.error('Export failed:', err);
      setResult({ id, success: false, message: 'Export failed. Please try again.' });
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="space-y-3">
      {EXPORT_OPTIONS.map((opt) => {
        const isActive = exporting === opt.id;
        const showResult = result?.id === opt.id;

        return (
          <div
            key={opt.id}
            className="flex items-center justify-between rounded-xl border border-stone-100 bg-stone-50/50 px-4 py-3 transition-colors dark:border-stone-700 dark:bg-stone-700/30"
          >
            <div className="flex flex-1 min-w-0 items-center gap-3">
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${opt.iconBg}`}
              >
                {opt.icon}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
                    {opt.label}
                  </span>
                  <span tabIndex={0} role="button" aria-label="More info" className="group relative inline-block focus:outline-none">
                    <svg className="h-4 w-4 cursor-pointer text-stone-400 hover:text-stone-600 dark:hover:text-stone-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                    <span className="invisible group-hover:visible group-focus:visible pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-xl bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 shadow-lg dark:bg-stone-700">
                      {opt.description}
                      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-stone-800 dark:border-t-stone-700" />
                    </span>
                  </span>
                </div>
                {showResult && (
                  <p
                    className={`mt-1 text-xs font-medium ${
                      result.success
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {result.success ? '✓ ' : '⚠ '}
                    {result.message}
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={isActive}
              onClick={() => handleExport(opt.id)}
              className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:shadow-lg hover:shadow-amber-200/60 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:shadow-amber-900/30 dark:hover:shadow-amber-900/40 dark:focus:ring-offset-stone-800"
            >
              {isActive ? (
                <span className="flex items-center gap-1.5">
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Exporting…
                </span>
              ) : (
                'Download'
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
