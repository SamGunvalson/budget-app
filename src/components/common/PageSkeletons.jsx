/**
 * Phase 6 — Page-level skeleton fallbacks for <Suspense> boundaries.
 *
 * Each skeleton mimics the rough layout of its target page so users see
 * a meaningful placeholder instead of a single generic spinner for every route.
 */

const shimmer =
  'animate-pulse rounded-xl bg-stone-200/60 dark:bg-stone-700/60';

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      {/* TopBar placeholder */}
      <div className="h-14 border-b border-stone-200 bg-white/80 dark:border-stone-800 dark:bg-stone-900/80" />
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</div>
    </div>
  );
}

export function TransactionsSkeleton() {
  return (
    <Shell>
      {/* Month selector */}
      <div className={`mb-6 h-10 w-56 ${shimmer}`} />
      {/* Stats row */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <div className={`h-20 ${shimmer}`} />
        <div className={`h-20 ${shimmer}`} />
        <div className={`h-20 ${shimmer}`} />
      </div>
      {/* Transaction rows */}
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={`mb-3 h-14 ${shimmer}`} />
      ))}
    </Shell>
  );
}

export function BudgetSkeleton() {
  return (
    <Shell>
      <div className={`mb-6 h-10 w-72 ${shimmer}`} />
      <div className={`mb-4 h-8 w-48 ${shimmer}`} />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`mb-3 h-16 ${shimmer}`} />
      ))}
    </Shell>
  );
}

export function ReportsSkeleton() {
  return (
    <Shell>
      <div className={`mb-6 h-10 w-64 ${shimmer}`} />
      {/* Tab bar */}
      <div className="mb-6 flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`h-9 w-24 ${shimmer}`} />
        ))}
      </div>
      {/* Chart placeholder */}
      <div className={`mb-6 h-64 ${shimmer}`} />
      {/* Category rows */}
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={`mb-3 h-12 ${shimmer}`} />
      ))}
    </Shell>
  );
}

export function AccountsSkeleton() {
  return (
    <Shell>
      <div className={`mb-6 h-10 w-56 ${shimmer}`} />
      {/* Net worth card */}
      <div className={`mb-6 h-28 ${shimmer}`} />
      {/* Account cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`h-32 ${shimmer}`} />
        ))}
      </div>
    </Shell>
  );
}

export function CategoriesSkeleton() {
  return (
    <Shell>
      <div className={`mb-6 h-10 w-48 ${shimmer}`} />
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className={`mb-3 h-12 ${shimmer}`} />
      ))}
    </Shell>
  );
}

export function SettingsSkeleton() {
  return (
    <Shell>
      <div className={`mb-6 h-10 w-40 ${shimmer}`} />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className={`mb-4 h-16 ${shimmer}`} />
      ))}
    </Shell>
  );
}

export function SplitsSkeleton() {
  return (
    <Shell>
      <div className={`mb-6 h-10 w-48 ${shimmer}`} />
      <div className={`mb-6 h-24 ${shimmer}`} />
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className={`mb-3 h-14 ${shimmer}`} />
      ))}
    </Shell>
  );
}
