import { useMemo } from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import { toDollars, formatPreMaskedDollars, formatPreMaskedAxisDollar } from '../../utils/helpers';
import { CHART_AXIS, CHART_GOLD, CHART_GRID, CHART_INCOME, CHART_MUTED, CHART_SPENDING } from '../../constants/chartColors';

/* ------------------------------------------------------------------ */
/*  Custom tooltip                                                     */
/* ------------------------------------------------------------------ */
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-4 py-3 shadow-lg shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="mb-1 text-sm font-semibold text-stone-700 dark:text-stone-300">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-sm" style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{formatPreMaskedDollars(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Year-over-Year comparison tooltip                                   */
/* ------------------------------------------------------------------ */
function YoYTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-4 py-3 shadow-lg shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="mb-1 text-sm font-semibold text-stone-700 dark:text-stone-300">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-sm" style={{ color: p.color }}>
          {p.name}: <span className="font-bold">{formatPreMaskedDollars(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main TrendChart component                                          */
/* ------------------------------------------------------------------ */

/**
 * Spending trend chart with two views:
 *   - "6m"   → Last 6 months area chart (spending vs income)
 *   - "12m"  → Last 12 months area chart
 *   - "yoy"  → Year-over-Year comparison (line chart, one line per year)
 *
 * Controlled component — range state and data are owned by the parent.
 *
 * @param {{
 *   range: '6m' | '12m' | 'yoy',
 *   setRange: (r: string) => void,
 *   monthlyData: Array<{ label: string, year: number, month: number, spent: number, income: number }>,
 *   isLoading: boolean,
 *   error: string,
 * }} props
 */
export default function TrendChart({ range, setRange, monthlyData = [], isLoading, error }) {
  // Safe mode: chart values are masked ONCE here (toDollars) so the drawn
  // shapes stay scrambled; tooltips and axes therefore use the
  // formatPreMasked* helpers, which do not mask a second time.
  /* ---- area chart data (6m / 12m) ---- */
  const areaData = useMemo(
    () =>
      monthlyData.map((m) => ({
        label: m.label,
        spent: toDollars(m.spent),
        income: toDollars(m.income),
      })),
    [monthlyData],
  );

  /* ---- Year-over-Year: rows like { month: "Jan", [2025]: dollars, [2026]: dollars } ---- */
  const { yoyData, yoyYears } = useMemo(() => {
    const yearSet = new Set();
    const monthMap = {};

    const SHORT_MONTHS = [
      '', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];

    for (const m of monthlyData) {
      yearSet.add(m.year);
      if (!monthMap[m.month]) {
        monthMap[m.month] = { month: SHORT_MONTHS[m.month], monthNum: m.month };
      }
      monthMap[m.month][m.year] = toDollars(m.spent);
    }

    const years = Array.from(yearSet).sort();
    const data = Object.values(monthMap).sort((a, b) => a.monthNum - b.monthNum);

    return { yoyData: data, yoyYears: years };
  }, [monthlyData]);

  /* ---- colour palette for YoY lines ---- */
  const YOY_COLORS = [CHART_MUTED, CHART_GOLD]; // muted for older year, gold for current

  /* ---- render ---- */
  return (
    <div className="animate-fade-in rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      {/* header + range toggle */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Spending Trends</h3>
        <div className="inline-flex rounded-xl border border-stone-200/60 bg-stone-50 p-1 shadow-sm dark:border-stone-700/60 dark:bg-stone-700/30">
          {[
            { key: '6m', label: '6 Months' },
            { key: '12m', label: '12 Months' },
            { key: 'yoy', label: 'Year over Year' },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setRange(opt.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all sm:text-sm ${
                range === opt.key
                  ? 'bg-sky-500 text-white shadow-md shadow-sky-200/50'
                  : 'text-stone-600 hover:bg-white dark:text-stone-400 dark:hover:bg-stone-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* error */}
      {error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </p>
      )}

      {/* loading skeleton */}
      {isLoading ? (
        <div className="h-64 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-700" />
      ) : range === 'yoy' ? (
        /* ---------- Year-over-Year line chart ---------- */
        yoyData.length === 0 ? (
          <p className="py-16 text-center text-sm text-stone-400 dark:text-stone-500">
            Not enough data for year-over-year comparison.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={yoyData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis
                dataKey="month"
                tick={{ fill: CHART_AXIS, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatPreMaskedAxisDollar}
                tick={{ fill: CHART_AXIS, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <Tooltip content={<YoYTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                wrapperStyle={{ fontSize: 13, paddingBottom: 8 }}
              />
              {yoyYears.map((yr, i) => (
                <Line
                  key={yr}
                  type="monotone"
                  dataKey={yr}
                  name={String(yr)}
                  stroke={YOY_COLORS[i % YOY_COLORS.length]}
                  strokeWidth={2.5}
                  dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )
      ) : (
        /* ---------- 6m / 12m area chart ---------- */
        areaData.length === 0 ? (
          <p className="py-16 text-center text-sm text-stone-400 dark:text-stone-500">
            No spending data for this period.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={areaData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id="gradSpent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_SPENDING} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={CHART_SPENDING} stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="gradIncome" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART_INCOME} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={CHART_INCOME} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} />
              <XAxis
                dataKey="label"
                tick={{ fill: CHART_AXIS, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatPreMaskedAxisDollar}
                tick={{ fill: CHART_AXIS, fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={70}
              />
              <Tooltip content={<TrendTooltip />} />
              <Legend
                verticalAlign="top"
                align="right"
                iconType="circle"
                wrapperStyle={{ fontSize: 13, paddingBottom: 8 }}
              />
              <Area
                type="monotone"
                dataKey="income"
                name="Income"
                stroke={CHART_INCOME}
                strokeWidth={2.5}
                fill="url(#gradIncome)"
                dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                activeDot={{ r: 6, strokeWidth: 2 }}
              />
              <Area
                type="monotone"
                dataKey="spent"
                name="Spending"
                stroke={CHART_SPENDING}
                strokeWidth={2.5}
                fill="url(#gradSpent)"
                dot={{ r: 4, strokeWidth: 2, fill: '#fff' }}
                activeDot={{ r: 6, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )
      )}
    </div>
  );
}
