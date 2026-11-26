import { lazy, Suspense } from 'react';
import { formatCurrency } from '../../utils/helpers';
// Phase 5: defer recharts-bound chart so the NetWorth summary card paints
// without waiting for the chart bundle to download/parse.
const NetWorthChart = lazy(() => import('./NetWorthChart'));

/**
 * NetWorthSummary — forest summary card (net worth, projection, assets vs
 * liabilities) followed by the net worth history chart in its own panel.
 *
 * Props:
 *  - netWorth: number (cents) — actual
 *  - projectedNetWorth: number (cents)
 *  - totalAssets: number (cents)
 *  - totalLiabilities: number (cents)
 *  - isLoading: boolean
 */
export default function NetWorthSummary({ netWorth = 0, projectedNetWorth = 0, totalAssets = 0, totalLiabilities = 0, isLoading = false, chartData = [], projectedChartData = [], chartLoading = false }) {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-stone-200/60 bg-white p-8 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <div className="animate-pulse space-y-4">
          <div className="h-4 w-24 rounded bg-stone-200 dark:bg-stone-700" />
          <div className="h-8 w-40 rounded bg-stone-200 dark:bg-stone-700" />
          <div className="flex gap-8">
            <div className="h-4 w-28 rounded bg-stone-200 dark:bg-stone-700" />
            <div className="h-4 w-28 rounded bg-stone-200 dark:bg-stone-700" />
          </div>
        </div>
      </div>
    );
  }

  const projectedDiff = projectedNetWorth - netWorth;
  const signed = (cents) => `${cents < 0 ? '−' : ''}${formatCurrency(Math.abs(cents))}`;
  const total = totalAssets + totalLiabilities;
  const assetPct = total > 0 ? (totalAssets / total) * 100 : 0;
  const tickMask = 'repeating-linear-gradient(90deg, #000 0 calc(2.5% - 2px), transparent calc(2.5% - 2px) 2.5%)';

  return (
    <div className="space-y-4">
      <section
        aria-label="Net worth"
        className="rounded-2xl bg-forest p-6 text-[#fbfcf2] shadow-lg shadow-stone-900/10 sm:p-7"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d8e9d8]">Net worth</p>
            <p className={`mt-1.5 font-display text-5xl font-normal leading-none tracking-tight sm:text-6xl ${netWorth < 0 ? 'text-[#f5b887]' : ''}`}>
              {signed(netWorth)}
            </p>
            <p className="mt-2 text-sm text-[#daeadc]">
              Projected {signed(projectedNetWorth)}
              {projectedDiff !== 0 && (
                <span className={`ml-1.5 font-semibold ${projectedDiff > 0 ? 'text-[#b8d9ac]' : 'text-[#f5b887]'}`}>
                  ({projectedDiff > 0 ? '+' : '−'}{formatCurrency(Math.abs(projectedDiff))})
                </span>
              )}
            </p>
          </div>

          <dl className="flex gap-8">
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#d8e9d8]">Assets</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{formatCurrency(totalAssets)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#d8e9d8]">Liabilities</dt>
              <dd className="mt-1 text-xl font-bold tabular-nums">{formatCurrency(totalLiabilities)}</dd>
            </div>
          </dl>
        </div>

        {/* Assets vs liabilities */}
        {total > 0 && (
          <div className="mt-6">
            <div
              aria-hidden="true"
              className="h-4"
              style={{
                background: `linear-gradient(to right, #b8d9ac 0 ${assetPct}%, #f5b887 ${assetPct}% 100%)`,
                maskImage: tickMask,
                WebkitMaskImage: tickMask,
              }}
            />
            <div className="mt-2 flex justify-between text-xs text-[#ecf4e9]">
              <span>{Math.round(assetPct)}% assets</span>
              <span>{Math.round(100 - assetPct)}% liabilities</span>
            </div>
          </div>
        )}
      </section>

      {/* Net worth history chart */}
      <Suspense
        fallback={
          <div className="h-56 animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-700/50" />
        }
      >
        <div className="rounded-2xl border border-stone-200/60 bg-white px-6 pb-6 shadow-sm empty:hidden dark:border-stone-700/60 dark:bg-stone-800">
          <NetWorthChart data={chartData} projectedData={projectedChartData} projectedNetWorth={projectedNetWorth} isLoading={chartLoading} />
        </div>
      </Suspense>
    </div>
  );
}
