import { formatCurrency } from '../../utils/helpers';
import NetWorthChart from './NetWorthChart';

/**
 * NetWorthSummary — top-level card showing net worth, assets, and liabilities.
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

  return (
    <div className="rounded-2xl border border-stone-200/60 bg-gradient-to-br from-white to-stone-50/50 p-8 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:from-stone-800 dark:to-stone-800/80 dark:shadow-stone-900/50">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        {/* Net Worth — actual and projected side-by-side */}
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Net Worth</p>
            <p className={`mt-1 text-4xl font-bold tabular-nums ${netWorth >= 0 ? 'text-stone-900 dark:text-stone-100' : 'text-red-600 dark:text-red-400'}`}>
              {netWorth < 0 && '−'}{formatCurrency(Math.abs(netWorth))}
            </p>
          </div>
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-violet-500 dark:text-violet-400">
              Projected
            </p>
            <div className="mt-1 flex items-baseline gap-2">
              <p className={`text-2xl font-bold tabular-nums ${projectedNetWorth >= 0 ? 'text-violet-600 dark:text-violet-400' : 'text-red-600 dark:text-red-400'}`}>
                {projectedNetWorth < 0 && '−'}{formatCurrency(Math.abs(projectedNetWorth))}
              </p>
              {projectedDiff !== 0 && (
                <span className={`text-xs font-semibold ${projectedDiff > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {projectedDiff > 0 ? '+' : '−'}{formatCurrency(Math.abs(projectedDiff))}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Assets & Liabilities breakdown */}
        <div className="flex gap-8">
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Assets</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-emerald-600">
              {formatCurrency(totalAssets)}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">Liabilities</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-red-600">
              {formatCurrency(totalLiabilities)}
            </p>
          </div>
        </div>
      </div>

      {/* Visual bar */}
      {(totalAssets > 0 || totalLiabilities > 0) && (
        <div className="mt-6">
          <div className="flex h-3 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-700">
            {totalAssets > 0 && (
              <div
                className="rounded-l-full bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-500"
                style={{ width: `${(totalAssets / (totalAssets + totalLiabilities)) * 100}%` }}
              />
            )}
            {totalLiabilities > 0 && (
              <div
                className="rounded-r-full bg-gradient-to-r from-red-400 to-red-500 transition-all duration-500"
                style={{ width: `${(totalLiabilities / (totalAssets + totalLiabilities)) * 100}%` }}
              />
            )}
          </div>
        </div>
      )}

      {/* Net worth history chart */}
      <NetWorthChart data={chartData} projectedData={projectedChartData} projectedNetWorth={projectedNetWorth} isLoading={chartLoading} />
    </div>
  );
}
