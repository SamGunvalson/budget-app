import { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceDot,
} from 'recharts';
import { toDollars, formatPreMaskedDollars, formatPreMaskedAxisDollar } from '../../utils/helpers';
import { CHART_AXIS } from '../../constants/chartColors';

// ─── Theme-aware series colors ───────────────────────────────────────────────
// CSS variables flip with the theme (deep forest in light, sage in dark), so
// the line matches the forest summary card above it in both modes.
const SERIES = 'var(--app-income)';
const PANEL = 'var(--app-panel)';
const LINE = 'var(--app-line)';

// ─── Custom tooltip ───────────────────────────────────────────────────────────
function NetWorthTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const actual = payload.find((p) => p.dataKey === 'netWorth' && p.value != null);
  const projected = payload.find((p) => p.dataKey === 'projected' && p.value != null);
  const entry = actual ?? projected;
  if (!entry) return null;

  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-3.5 py-2.5 shadow-lg shadow-stone-900/10 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500 dark:text-stone-400">
        {label}
        {!actual && <span className="ml-1.5 normal-case tracking-normal font-medium">· projected</span>}
      </p>
      <p
        className={`mt-0.5 font-display text-xl leading-tight tabular-nums ${
          entry.value < 0 ? 'text-red-600 dark:text-red-400' : 'text-ink'
        }`}
      >
        {entry.value < 0 ? '−' : ''}{formatPreMaskedDollars(Math.abs(entry.value))}
      </p>
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
 * NetWorthChart — section label plus a panel with a monthly net worth line
 * (faint fill) and an optional dashed projection continuing the same line.
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
  // Safe mode: values are masked ONCE here (toDollars) so the drawn shape stays
  // scrambled; the tooltip and axis use formatPreMasked* and never mask again.
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

  // "Today" marker: the last actual point, where the dashed projection begins.
  const todayPoint = useMemo(() => {
    for (let i = chartData.length - 1; i >= 0; i -= 1) {
      if (chartData[i].netWorth != null) return chartData[i];
    }
    return null;
  }, [chartData]);
  const hasProjection = filteredProjected.length > 0;

  // Decide tick interval so X axis doesn't get crowded
  const tickInterval = useMemo(() => {
    const n = chartData.length;
    if (n <= 12) return 0;
    if (n <= 24) return 1;
    if (n <= 48) return 2;
    return Math.floor(n / 16);
  }, [chartData]);

  if (isLoading) {
    return <div className="h-72 animate-pulse rounded-2xl bg-stone-100 dark:bg-stone-700/50" />;
  }

  if (!data.length) return null;

  return (
    <section aria-labelledby="nw-chart-title" className="space-y-2">
      <h2
        id="nw-chart-title"
        className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600 dark:text-stone-300"
      >
        Net worth over time
      </h2>

      <div className="rounded-2xl border border-stone-200/60 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-700/60 dark:bg-stone-800">
        {/* Legend + range toggle */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-[11px] font-medium text-soft">
            <span className="flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden="true" className="shrink-0">
                <line x1="0" y1="3" x2="16" y2="3" stroke={SERIES} strokeWidth="2" strokeLinecap="round" />
              </svg>
              Actual
            </span>
            {hasProjection && (
              <span className="flex items-center gap-1.5">
                <svg width="16" height="6" aria-hidden="true" className="shrink-0">
                  <line x1="1" y1="3" x2="15" y2="3" stroke={SERIES} strokeOpacity="0.55" strokeWidth="2" strokeDasharray="3 3" strokeLinecap="round" />
                </svg>
                Projected
              </span>
            )}
          </div>
          <div className="inline-flex rounded-lg border border-stone-200/60 bg-stone-50 p-0.5 dark:border-stone-700/60 dark:bg-stone-700/30">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                aria-pressed={range === opt.key}
                onClick={() => setRange(opt.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                  range === opt.key
                    ? 'bg-stone-900 text-stone-50 shadow-sm dark:bg-stone-100 dark:text-stone-900'
                    : 'text-stone-600 hover:bg-white dark:text-stone-400 dark:hover:bg-stone-600'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {chartData.length === 0 ? (
          <p className="py-10 text-center text-sm text-stone-400 dark:text-stone-500">
            No data for this period.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={chartData} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={LINE} strokeOpacity={0.7} />
              <XAxis
                dataKey="label"
                tick={{ fill: CHART_AXIS, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval={tickInterval}
                tickMargin={8}
              />
              <YAxis
                tickFormatter={formatPreMaskedAxisDollar}
                tick={{ fill: CHART_AXIS, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickCount={4}
                width={56}
              />
              <Tooltip
                content={<NetWorthTooltip />}
                cursor={{ stroke: LINE, strokeWidth: 1 }}
              />

              {/* Actual: solid forest line with a barely-there wash */}
              <Area
                type="monotone"
                dataKey="netWorth"
                name="Net Worth"
                stroke={SERIES}
                strokeWidth={2.25}
                fill={SERIES}
                fillOpacity={0.07}
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, fill: PANEL, stroke: SERIES }}
                connectNulls={false}
              />

              {/* Projected: the same line, dashed and quieter, no fill */}
              {hasProjection && (
                <Area
                  type="monotone"
                  dataKey="projected"
                  name="Projected"
                  stroke={SERIES}
                  strokeOpacity={0.55}
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  fill="none"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, fill: PANEL, stroke: SERIES }}
                  connectNulls={false}
                />
              )}

              {/* Today: a dot where actual hands off to projected */}
              {hasProjection && todayPoint && (
                <ReferenceDot
                  x={todayPoint.label}
                  y={todayPoint.netWorth}
                  r={4.5}
                  fill={SERIES}
                  stroke={PANEL}
                  strokeWidth={2}
                  label={{ value: 'Today', position: 'top', offset: 10, fontSize: 10, fontWeight: 600, fill: CHART_AXIS }}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
