/**
 * Page-level skeleton fallbacks for <Suspense> boundaries.
 *
 * Each skeleton mirrors its page's Forest & Gold layout — top bar, eyebrow +
 * serif title, forest summary card, and hairline list panels — so the swap to
 * real content doesn't jump. Motion is the Tailwind pulse, which the global
 * reduced-motion rule in index.css turns off.
 */
import BrandMark from './BrandMark';

const shimmer = 'animate-pulse rounded-xl bg-stone-200/70 dark:bg-stone-700/60';
const panel = 'rounded-2xl border border-stone-200/60 bg-white shadow-sm dark:border-stone-700/60 dark:bg-stone-800';

function Shell({ width = 'max-w-6xl', children }) {
  return (
    <div className="min-h-screen app-bg" aria-busy="true" aria-label="Loading">
      {/* TopBar placeholder: brand row + desktop tab row */}
      <div className="safe-area-pt border-b border-stone-200/60 bg-panel/85 dark:border-stone-700/60">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <BrandMark />
          <span className="font-display text-xl font-semibold tracking-tight text-stone-900 dark:text-stone-100">Budget App</span>
        </div>
        <div className="hidden border-t border-stone-200/60 desktop:block dark:border-stone-700/60">
          <div className="mx-auto flex max-w-6xl gap-6 px-4 py-3 sm:px-6">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={`h-4 w-20 ${shimmer}`} />
            ))}
          </div>
        </div>
      </div>
      <div className={`mx-auto ${width} px-4 py-8 sm:px-6`}>{children}</div>
    </div>
  );
}

function HeaderSkeleton() {
  return (
    <div className="mb-8">
      <div className={`mb-2 h-3 w-28 ${shimmer}`} />
      <div className={`h-9 w-56 ${shimmer}`} />
    </div>
  );
}

function HeroSkeleton({ height = 'h-44' }) {
  return <div className={`mb-6 animate-pulse rounded-2xl bg-forest/85 ${height}`} />;
}

function ListPanel({ rows = 5, well = true }) {
  return (
    <div className={`divide-y divide-stone-200/60 overflow-hidden dark:divide-stone-700/60 ${panel}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          {well && <div className={`h-9 w-9 shrink-0 ${shimmer}`} />}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className={`h-3.5 w-2/5 ${shimmer}`} />
            <div className={`h-3 w-1/4 ${shimmer}`} />
          </div>
          <div className={`h-4 w-16 ${shimmer}`} />
        </div>
      ))}
    </div>
  );
}

export function TransactionsSkeleton() {
  return (
    <Shell>
      <HeaderSkeleton />
      <div className={`mb-4 h-10 w-44 ${shimmer}`} />
      <div className="mb-6 flex flex-wrap gap-3">
        <div className={`h-10 w-40 ${shimmer}`} />
        <div className={`h-10 w-56 ${shimmer}`} />
      </div>
      <ListPanel rows={8} />
    </Shell>
  );
}

export function BudgetSkeleton() {
  return (
    <Shell width="max-w-4xl">
      <HeaderSkeleton />
      <div className={`mb-6 h-10 w-64 ${shimmer}`} />
      <HeroSkeleton />
      <div className={`mb-2 h-3 w-24 ${shimmer}`} />
      <div className="mb-6"><ListPanel rows={4} /></div>
      <div className={`mb-2 h-3 w-24 ${shimmer}`} />
      <ListPanel rows={3} />
    </Shell>
  );
}

export function ReportsSkeleton() {
  return (
    <Shell>
      <HeaderSkeleton />
      {/* Overview tab (the default): forest hero, then two columns of panels */}
      <div className="mb-6 h-48 animate-pulse rounded-2xl bg-forest/85" />
      <div className="grid gap-6 lg:grid-cols-2">
        <ListPanel rows={3} well={false} />
        <ListPanel rows={3} well={false} />
      </div>
    </Shell>
  );
}

export function AccountsSkeleton() {
  return (
    <Shell>
      <HeaderSkeleton />
      <div className={`mb-6 h-10 w-48 ${shimmer}`} />
      <HeroSkeleton height="h-48" />
      <div className={`mb-6 h-56 ${panel}`} />
      <div className="grid gap-6 lg:grid-cols-2">
        <ListPanel rows={2} />
        <ListPanel rows={2} />
      </div>
    </Shell>
  );
}

export function CategoriesSkeleton() {
  return (
    <Shell>
      <HeaderSkeleton />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`flex h-[70px] items-center gap-3 px-4 ${panel}`}>
            <div className={`h-9 w-9 ${shimmer}`} />
            <div className={`h-3.5 w-1/3 ${shimmer}`} />
          </div>
        ))}
      </div>
    </Shell>
  );
}

export function SettingsSkeleton() {
  return (
    <Shell width="max-w-4xl">
      <HeaderSkeleton />
      <div className={`mb-6 h-40 ${panel}`} />
      <div className="grid gap-6 sm:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`h-36 ${panel}`} />
        ))}
      </div>
    </Shell>
  );
}

export function SplitsSkeleton() {
  return (
    <Shell width="max-w-4xl">
      <HeaderSkeleton />
      <HeroSkeleton />
      <ListPanel rows={5} well={false} />
    </Shell>
  );
}
