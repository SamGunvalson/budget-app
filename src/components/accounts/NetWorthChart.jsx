import { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { toDollars, formatCurrency, formatAxisDollar } from '../../utils/helpers';

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function NetWorthTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const actualEntry = payload.find((p) => p.dataKey === 'netWorth');
  const projectedEntry = payload.find((p) => p.dataKey === 'projected');

  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-4 py-3 shadow-lg shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="mb-1 text-sm font-semibold text-stone-700 dark:text-stone-300">{label}</p>
      {actualEntry != null && actualEntry.value != null && (
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <p className={`text-sm font-bold ${actualEntry.value < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
            {actualEntry.value < 0 ? '−' : ''}{formatCurrency(Math.abs(Math.round(actualEntry.value * 100)))}
          </p>
        </div>
      )}
      {projectedEntry != null && projectedEntry.value != null && (
        <div className="flex items-center gap-2 mt-0.5">
          <span className="h-2 w-2 rounded-full bg-violet-500" />
          <p className="text-sm font-bold text-violet-600 dark:text-violet-400">
            {projectedEntry.value < 0 ? '−' : ''}{formatCurrency(Math.abs(Math.round(projectedEntry.value * 100)))}
            <span className="ml-1 text-[10px] font-medium text-violet-400 dark:text-violet-500">projected</span>
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Range options ────────────────────────────────────────────────────────────
const RANGE_OPTIONS = [
  { key: '1y', label: '1Y' },
  { key: '3y', label: '3Y' },
  { key: 'all', label: 'All' },
];

/**
 * NetWorthChart — monthly area chart of net worth over time with optional projected future line.
 *
 * Props:
 *  - data: Array<{ yearMonth: string, label: string, netWorth: number }>  (cents) — history
 *  - projectedData: Array<{ yearMonth: string, label: string, netWorth: number }> (cents) — future
 *  - projectedNetWorth: number (cents) — account-balance computed projected total; overrides the
 *      last projected chart point so the chart endpoint matches the summary card exactly.
 *  - isLoading: boolean
 */
export default function NetWorthChart({ data = [], projectedData = [], projectedNetWorth = null, isLoading = false }) {
  const [range, setRange] = useState('1y');

  // Current month string (YYYY-MM) for range filtering and reference line
  const currentYM = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }, []);

  const filteredHistory = useMemo(() => {
    if (!data.length) return [];
    if (range === 'all') return data;

    const monthsBack = range === '1y' ? 12 : 36;
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - monthsBack + 1, 1);
    const cutoffYM = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
    return data.filter((d) => d.yearMonth >= cutoffYM);
  }, [data, range]);

  const filteredProjected = useMemo(() => {
    if (!projectedData.length) return [];
    if (range === 'all') return projectedData;

    const monthsForward = range === '1y' ? 12 : 36;
    const now = new Date();
    const cutoffEnd = new Date(now.getFullYear(), now.getMonth() + monthsForward, 1);
    const cutoffEndYM = `${cutoffEnd.getFullYear()}-${String(cutoffEnd.getMonth() + 1).padStart(2, '0')}`;
    return projectedData.filter((d) => d.yearMonth <= cutoffEndYM);
  }, [projectedData, range]);

  // Merge history and projected into a single series for the combo chart.
  // Historical points have `netWorth`; projected points have `projected`.
  // The last history point is echoed as the first projected point so lines connect.
  const chartData = useMemo(() => {
    const hist = filteredHistory.map((d) => ({
      yearMonth: d.yearMonth,
      label: d.label,
      netWorth: toDollars(d.netWorth),
      projected: null,
    }));

    if (!filteredProjected.length) return hist;

    // Bridge: copy the last history value into the first projected point so lines connect
    const lastHist = hist[hist.length - 1];
    const bridgeValue = lastHist ? lastHist.netWorth : null;

    const proj = filteredProjected.map((d, i) => ({
      yearMonth: d.yearMonth,
      label: d.label,
      netWorth: null,
      projected: toDollars(d.netWorth),
      ...(i === 0 && bridgeValue != null ? { projectedBridge: bridgeValue } : {}),
    }));

    // Patch the last history point to include bridge for seamless connection
    if (hist.length > 0 && proj.length > 0) {
      hist[hist.length - 1] = { ...hist[hist.length - 1], projected: bridgeValue };
    }

    // Override the last projected point to match the account-balance projected total so
    // the chart endpoint and the summary card show the exact same number.
    if (proj.length > 0 && projectedNetWorth != null) {
      proj[proj.length - 1] = { ...proj[proj.length - 1], projected: toDollars(projectedNetWorth) };
    }

    return [...hist, ...proj];
  }, [filteredHistory, filteredProjected, projectedNetWorth]);

  // Label of the current month tick (for reference line)
  const currentLabel = useMemo(() => {
    const match = data.find((d) => d.yearMonth === currentYM);
    return match?.label ?? null;
  }, [data, currentYM]);

  // Decide tick interval so X axis doesn't get crowded
  const tickInterval = useMemo(() => {
    const n = chartData.length;
    if (n <= 12) return 0;
    if (n <= 24) return 1;
    if (n <= 48) return 2;
    return Math.floor(n / 16);
  }, [chartData]);

  if (isLoading) {
    return (
      <div className="mt-6">
        <div className="h-52 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-700/50" />
      </div>
    );
  }

  if (!data.length) return null;

  return (
    <div className="mt-6">
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Net Worth Over Time
          </p>
          {filteredProjected.length > 0 && (
            <div className="flex items-center gap-1.5">
              <svg width="20" height="8" className="shrink-0">
                <line x1="0" y1="4" x2="20" y2="4" stroke="#8b5cf6" strokeWidth="2" strokeDasharray="4 2" />
              </svg>
              <span className="text-[10px] font-medium text-violet-500 dark:text-violet-400">Projected</span>
            </div>
          )}
        </div>
        {/* Range toggle */}
        <div className="inline-flex rounded-lg border border-stone-200/60 bg-stone-50 p-0.5 shadow-sm dark:border-stone-700/60 dark:bg-stone-700/30">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRange(opt.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                range === opt.key
                  ? 'bg-amber-500 text-white shadow-sm shadow-amber-200/50'
                  : 'text-stone-600 hover:bg-white dark:text-stone-400 dark:hover:bg-stone-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {chartData.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400 dark:text-stone-500">
          No data for this period.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={chartData} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="gradNetWorth" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.30} />
                <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="gradProjected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.20} />
                <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" className="dark:stroke-stone-700" />
            <XAxis
              dataKey="label"
              tick={{ fill: '#78716c', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
            />
            <YAxis
              tickFormatter={formatAxisDollar}
              tick={{ fill: '#78716c', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={72}
            />
            <Tooltip content={<NetWorthTooltip />} />

            {/* Reference line at current month */}
            {currentLabel && filteredProjected.length > 0 && (
              <ReferenceLine
                x={currentLabel}
                stroke="#a8a29e"
                strokeDasharray="3 3"
                strokeWidth={1.5}
                label={{ value: 'Today', position: 'insideTopRight', fontSize: 10, fill: '#a8a29e' }}
              />
            )}

            {/* Historical area */}
            <Area
              type="monotone"
              dataKey="netWorth"
              name="Net Worth"
              stroke="#10b981"
              strokeWidth={2.5}
              fill="url(#gradNetWorth)"
              dot={false}
              activeDot={{ r: 5, strokeWidth: 2, fill: '#fff', stroke: '#10b981' }}
              connectNulls={false}
            />

            {/* Projected area (dotted) */}
            {filteredProjected.length > 0 && (
              <Area
                type="monotone"
                dataKey="projected"
                name="Projected"
                stroke="#8b5cf6"
                strokeWidth={2}
                strokeDasharray="5 3"
                fill="url(#gradProjected)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#8b5cf6' }}
                connectNulls={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
