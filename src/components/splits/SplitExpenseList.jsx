import { useState, useMemo } from 'react';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'me', label: 'You paid' },
  { value: 'partner', label: 'They paid' },
];

function getMonthLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export default function SplitExpenseList({ expenses, currentUserId, partnerEmail, onDelete, loading }) {
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    if (filter === 'me') return expenses.filter((e) => e.paid_by_user_id === currentUserId);
    if (filter === 'partner') return expenses.filter((e) => e.paid_by_user_id !== currentUserId);
    return expenses;
  }, [expenses, filter, currentUserId]);

  // Group filtered expenses by month label, preserving order
  const grouped = useMemo(() => {
    const groups = [];
    let currentLabel = null;
    for (const exp of filtered) {
      const label = getMonthLabel(exp.expense_date);
      if (label !== currentLabel) {
        groups.push({ label, items: [] });
        currentLabel = label;
      }
      groups[groups.length - 1].items.push(exp);
    }
    return groups;
  }, [filtered]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header + filter tabs */}
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
          Expenses
        </h2>
        <div className="flex items-center gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-800/60">
          {FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setFilter(value)}
              className={`rounded-lg px-3 py-1 text-xs font-semibold transition-all ${
                filter === value
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 p-8 text-center dark:border-stone-700 dark:bg-stone-900/30">
          <svg className="mx-auto h-12 w-12 text-stone-300 dark:text-stone-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
          </svg>
          <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
            {filter === 'all' ? 'No split expenses yet. Add one to get started!' : 'No expenses match this filter.'}
          </p>
        </div>
      )}

      {/* Month-grouped expense rows */}
      {grouped.map(({ label, items }) => (
        <div key={label}>
          <p className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-widest text-stone-400 dark:text-stone-500 first:mt-0">
            {label}
          </p>
          <div className="space-y-2">
            {items.map((exp) => {
              const iPaid = exp.paid_by_user_id === currentUserId;
              const dollars = (exp.total_amount / 100).toFixed(2);
              // partner_share is always the non-payer's obligation
              const obligationDollars = (exp.partner_share / 100).toFixed(2);

              return (
                <div
                  key={exp.id}
                  className={`group rounded-xl border px-3 py-2 transition-colors ${
                    exp.is_settlement
                      ? 'border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-800/40 dark:bg-emerald-950/10'
                      : 'border-stone-200/60 bg-white hover:bg-stone-50/50 dark:border-stone-700/60 dark:bg-stone-800 dark:hover:bg-stone-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {/* Description + settlement badge */}
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                          {exp.description}
                        </p>
                        {exp.is_settlement && (
                          <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            Settlement
                          </span>
                        )}
                      </div>

                      {/* Date · who paid · obligation badge — all inline */}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-xs text-stone-400 dark:text-stone-500">
                          {new Date(exp.expense_date + 'T00:00:00').toLocaleDateString()}
                          {' · '}
                          {iPaid ? 'You paid' : `${partnerEmail} paid`}
                        </span>
                        {!exp.is_settlement && (
                          iPaid ? (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700 dark:bg-teal-900/20 dark:text-teal-400">
                              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15m0 0l6.75 6.75M4.5 12l6.75-6.75" />
                              </svg>
                              They owe you ${obligationDollars}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-900/20 dark:text-red-400">
                              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
                              </svg>
                              You owe ${obligationDollars}
                            </span>
                          )
                        )}
                      </div>
                    </div>

                    {/* Total + delete */}
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold tabular-nums ${
                        exp.is_settlement
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-stone-900 dark:text-stone-100'
                      }`}>
                        ${dollars}
                      </p>
                      <button
                        onClick={() => setConfirmDelete(exp.id)}
                        className="rounded-lg p-1 text-stone-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-stone-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                        title="Delete"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Confirm delete inline */}
                  {confirmDelete === exp.id && (
                    <div className="mt-2 flex items-center justify-end gap-2 border-t border-stone-100 pt-2 dark:border-stone-700">
                      <span className="text-xs text-stone-500 dark:text-stone-400">Delete this entry?</span>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="rounded-lg px-2.5 py-1 text-xs font-medium text-stone-500 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-700"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          onDelete(exp.id);
                          setConfirmDelete(null);
                        }}
                        className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-600"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
