import { useState } from 'react';

export default function SplitExpenseList({ expenses, currentUserId, partnerEmail, onDelete, loading }) {
  const [confirmDelete, setConfirmDelete] = useState(null);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-800" />
        ))}
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 p-8 text-center dark:border-stone-700 dark:bg-stone-900/30">
        <svg className="mx-auto h-12 w-12 text-stone-300 dark:text-stone-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" />
        </svg>
        <p className="mt-3 text-sm text-stone-500 dark:text-stone-400">
          No split expenses yet. Add one to get started!
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100 mb-3">
        Expenses
      </h2>
      {expenses.map((exp) => {
        const iPaid = exp.paid_by_user_id === currentUserId;
        const dollars = (exp.total_amount / 100).toFixed(2);
        const myShare = iPaid ? exp.payer_share : exp.partner_share;
        const myShareDollars = (myShare / 100).toFixed(2);

        return (
          <div
            key={exp.id}
            className={`group rounded-xl border px-4 py-3 transition-colors ${
              exp.is_settlement
                ? 'border-emerald-200/60 bg-emerald-50/30 dark:border-emerald-800/40 dark:bg-emerald-950/10'
                : 'border-stone-200/60 bg-white hover:bg-stone-50/50 dark:border-stone-700/60 dark:bg-stone-800 dark:hover:bg-stone-800/80'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
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
                <div className="mt-0.5 flex items-center gap-2 text-xs text-stone-400 dark:text-stone-500">
                  <span>{new Date(exp.expense_date + 'T00:00:00').toLocaleDateString()}</span>
                  <span>·</span>
                  <span>{iPaid ? 'You paid' : `${partnerEmail} paid`}</span>
                  {!exp.is_settlement && (
                    <>
                      <span>·</span>
                      <span>Your share: ${myShareDollars}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <p className={`text-sm font-semibold tabular-nums ${
                  exp.is_settlement
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-stone-900 dark:text-stone-100'
                }`}>
                  ${dollars}
                </p>
                <button
                  onClick={() => setConfirmDelete(exp.id)}
                  className="rounded-lg p-1.5 text-stone-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 dark:text-stone-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
                  title="Delete"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
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
  );
}
