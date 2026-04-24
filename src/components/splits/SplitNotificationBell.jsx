import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

/**
 * Bell icon button with notification badge for split expenses.
 *
 * Mobile: tapping the bell opens a bottom sheet that slides up from the bottom.
 * Desktop: opens a dropdown panel anchored below the bell button.
 */
export default function SplitNotificationBell({
  unseenCount,
  unseenExpenses,
  partnerEmail,
  currentUserId,
  onMarkSeen,
  loading,
}) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);
  const navigate = useNavigate();

  // Close on click outside (desktop only — mobile has overlay backdrop)
  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        buttonRef.current && !buttonRef.current.contains(e.target)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const handleToggle = () => {
    if (!open && unseenCount > 0) {
      onMarkSeen();
    }
    setOpen((v) => !v);
  };

  const handleViewAll = () => {
    setOpen(false);
    navigate('/app/splits');
  };

  const formatDate = (dateStr) =>
    new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });

  const formatAmount = (cents) => `$${(cents / 100).toFixed(2)}`;

  return (
    <div className="relative">
      {/* Bell button */}
      <button
        ref={buttonRef}
        type="button"
        aria-label={unseenCount > 0 ? `${unseenCount} new split expense${unseenCount !== 1 ? 's' : ''}` : 'Split notifications'}
        aria-expanded={open}
        onClick={handleToggle}
        disabled={unseenCount === 0}
        className={`relative flex items-center justify-center rounded-lg p-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
          unseenCount === 0
            ? 'cursor-default text-stone-300 dark:text-stone-600'
            : open
              ? 'bg-pink-100 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400'
              : 'text-stone-500 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200'
        }`}
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
        </svg>

        {/* Badge */}
        {unseenCount > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm">
            {unseenCount > 9 ? '9+' : unseenCount}
          </span>
        )}
      </button>

      {/* ── Mobile bottom sheet backdrop ── */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          aria-hidden="true"
          onPointerDown={() => setOpen(false)}
        />
      )}

      {/* ── Panel (bottom sheet on mobile, dropdown on desktop) ── */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="New split expenses"
          className={[
            // Shared
            'z-50 flex flex-col overflow-hidden bg-white dark:bg-stone-800',
            // Mobile: fixed bottom sheet
            'fixed inset-x-0 bottom-0 max-h-[70vh] rounded-t-2xl shadow-2xl',
            // Desktop override: absolute dropdown
            'md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-2 md:w-80 md:max-h-96 md:rounded-xl md:shadow-xl',
            'md:border md:border-stone-200/60 dark:md:border-stone-700/60',
            // Animate slide up on mobile
            'animate-slide-up-mobile md:animate-none',
          ].join(' ')}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-stone-200/60 px-4 py-3 dark:border-stone-700/60">
            <div>
              <p className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                {unseenCount > 0 ? 'New from partner' : 'Split notifications'}
              </p>
              {partnerEmail && (
                <p className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">
                  {partnerEmail}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-600 dark:text-stone-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="space-y-2 p-4">
                {[1, 2].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-lg bg-stone-100 dark:bg-stone-700" />
                ))}
              </div>
            ) : unseenExpenses.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
                <svg className="mb-2 h-10 w-10 text-stone-300 dark:text-stone-600" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
                <p className="text-sm text-stone-500 dark:text-stone-400">You're all caught up!</p>
              </div>
            ) : (
              <ul className="divide-y divide-stone-100 dark:divide-stone-700/60">
                {unseenExpenses.slice(0, 5).map((exp) => {
                  const iPaid = exp.paid_by_user_id === currentUserId;
                  const obligationDollars = formatAmount(exp.partner_share);
                  return (
                    <li key={exp.id} className="flex items-center gap-3 px-4 py-3">
                      {/* Icon */}
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pink-50 dark:bg-pink-900/20">
                        <svg className="h-4 w-4 text-pink-500 dark:text-pink-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                        </svg>
                      </div>

                      {/* Details */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-stone-900 dark:text-stone-100">
                          {exp.description}
                        </p>
                        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs text-stone-400 dark:text-stone-500">
                            {formatDate(exp.expense_date)}
                          </span>
                          {!exp.is_settlement && (
                            iPaid ? (
                              <span className="rounded-full bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900/20 dark:text-teal-400">
                                They owe you {obligationDollars}
                              </span>
                            ) : (
                              <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                You owe {obligationDollars}
                              </span>
                            )
                          )}
                        </div>
                      </div>

                      {/* Amount */}
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">
                        {formatAmount(exp.total_amount)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-stone-100 px-4 py-3 dark:border-stone-700/60">
            <button
              type="button"
              onClick={handleViewAll}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-pink-50 px-4 py-2.5 text-sm font-semibold text-pink-600 transition-colors hover:bg-pink-100 active:scale-[0.98] dark:bg-pink-900/20 dark:text-pink-400 dark:hover:bg-pink-900/30"
            >
              View all splits
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
