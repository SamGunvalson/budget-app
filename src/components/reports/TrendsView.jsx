import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import CategoryWell from '../common/CategoryWell';
import DataUnavailable from '../common/DataUnavailable';
import ChangeChip from './ChangeChip';
import TrendChart from './TrendChart';
import useReportData from '../../hooks/useReportData';
import useSessionState from '../../hooks/useSessionState';
import { computeTrendSummary } from '../../services/analytics';
import {
  CATEGORY_FALLBACK_COLOR,
  CHART_AXIS,
  CHART_GRID,
  CHART_MUTED,
  CHART_SURFACE,
  FIXED_FLEX_COLORS,
  MIX_COLORS,
} from '../../constants/chartColors';
import { TYPE_COLORS } from '../../constants/palette';
import {
  CATEGORY_TYPE_LABELS,
  formatCurrency,
  formatPreMaskedAxisDollar,
  formatPreMaskedDollars,
  getMonthName,
  toDollars,
} from '../../utils/helpers';
import {
  averageMonths,
  biggestChanges,
  categorySeries,
  fixedFlexibleByMonth,
  monthLabel,
  monthRange,
  trendSeries,
} from '../../utils/reportAggregations';

const money = (cents) => formatCurrency(cents, 'USD', { hideCents: true });

const RANGE_MONTHS = { '6m': 6, '12m': 12, yoy: 24 };
const PANEL = 'animate-fade-in rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50';
const PANEL_TITLE = 'text-lg font-semibold text-stone-900 dark:text-stone-100';
const PANEL_SUB = 'text-xs text-stone-500 dark:text-stone-400';
const AXIS = { tick: { fill: CHART_AXIS, fontSize: 12 }, axisLine: false, tickLine: false };

/**
 * Legend props: labels in the axis text color (the dot carries identity) and
 * items in series order. Recharts sorts legend items by name by default;
 * `order` lists dataKeys in stack order instead.
 */
const legendProps = (order) => ({
  verticalAlign: 'top',
  align: 'right',
  iconType: 'circle',
  wrapperStyle: { fontSize: 13, paddingBottom: 8 },
  formatter: (value) => <span style={{ color: CHART_AXIS }}>{value}</span>,
  itemSorter: (item) => order.indexOf(item.dataKey),
});

/** Short x-axis label: "Nov" (or "Nov '26" when the range spans years). */
function tickLabel(label, spansYears) {
  const [mon, yr] = label.split(' ');
  return spansYears ? `${mon} '${yr.slice(2)}` : mon;
}

/**
 * Tooltip for masked chart values. `rows` are { name, value, color } with
 * values already masked once by toDollars, so they are formatted with the
 * pre-masked helper (never masked twice).
 */
function ChartTooltip({ active, payload, label, extra }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-4 py-3 text-sm shadow-lg shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="mb-1 font-semibold text-stone-700 dark:text-stone-300">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-stone-700 dark:text-stone-300">
          <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          {p.name}: <span className="font-semibold tabular-nums">{formatPreMaskedDollars(p.value, 'USD', { hideCents: true })}</span>
        </p>
      ))}
      {extra?.(payload[0]?.payload)}
    </div>
  );
}

function PercentTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const value = payload[0].value;
  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-4 py-3 text-sm shadow-lg dark:border-stone-700/60 dark:bg-stone-800">
      <p className="mb-1 font-semibold text-stone-700 dark:text-stone-300">{label}</p>
      <p className="text-stone-700 dark:text-stone-300">
        Savings rate: <span className="font-semibold tabular-nums">{value == null ? '—' : `${Math.round(value)}%`}</span>
      </p>
    </div>
  );
}

/** Parse the session-stored category-trend selection ("type:wants" / "cat:<id>"). */
function parseSelection(value) {
  const [kind, ...rest] = String(value ?? '').split(':');
  const id = rest.join(':');
  if (kind === 'type' && id) return { kind: 'type', id };
  if (kind === 'cat' && id) return { kind: 'category', id };
  return { kind: 'type', id: 'wants' };
}

/**
 * Reports › Trends: income vs spending, where income went (needs / wants /
 * saved) with the savings rate, fixed bills vs flexible spending, a trend for
 * any category or type, and the biggest category changes. Computed on the
 * client from the year transactions (offline-capable), with the same
 * definitions as Overview.
 *
 * @param {{ month: number, year: number, range: '6m' | '12m' | 'yoy', asOf: string | null }} props
 */
export default function TrendsView({ month, year, range, asOf }) {
  const months = RANGE_MONTHS[range] ?? 6;
  const keys = useMemo(() => monthRange(year, month, months), [year, month, months]);
  const spansYears = keys[0].slice(0, 4) !== keys[keys.length - 1].slice(0, 4);
  const [selectionValue, setSelectionValue] = useSessionState('reportsTrendCategory', 'type:wants');
  const selection = parseSelection(selectionValue);

  const { settled, matrix, categories, isLoading, failed } = useReportData({ year, keyLists: [keys], asOf });

  const data = useMemo(() => {
    const series = trendSeries(matrix, keys);
    const fixedFlex = fixedFlexibleByMonth(settled, keys);
    // Safe mode: chart values are masked ONCE here (toDollars); tooltips and
    // axes use the formatPreMasked* helpers so they are not masked again.
    const mixRows = series.map((m) => ({
      label: tickLabel(m.label, spansYears),
      fullLabel: m.label,
      needs: toDollars(m.needs),
      wants: toDollars(m.wants),
      saved: toDollars(m.saved),
      rate: m.savingsRate == null ? null : m.savingsRate * 100,
    }));
    const fixedRows = fixedFlex.map((m) => ({
      label: tickLabel(monthLabel(m.key), spansYears),
      fullLabel: monthLabel(m.key),
      fixed: toDollars(m.fixed),
      flexible: toDollars(m.flexible),
    }));
    const fixedAvg = Math.round(fixedFlex.reduce((s, m) => s + m.fixed, 0) / keys.length);
    const flexAvg = Math.round(fixedFlex.reduce((s, m) => s + m.flexible, 0) / keys.length);
    const savedTotal = series.reduce((s, m) => s + m.saved, 0);
    const incomeTotal = series.reduce((s, m) => s + m.income, 0);
    return { series, mixRows, fixedRows, fixedAvg, flexAvg, savedTotal, incomeTotal };
  }, [matrix, settled, keys, spansYears]);

  const categoryTrend = useMemo(() => {
    const { points, average } = categorySeries(matrix, keys, selection);
    return {
      rows: points.map((p) => ({ label: tickLabel(p.label, spansYears), fullLabel: p.label, value: toDollars(p.value) })),
      average: toDollars(average),
      rawAverage: average,
    };
  }, [matrix, keys, selection, spansYears]);

  const changes = useMemo(
    () => biggestChanges(matrix, year, month, { categories }),
    [matrix, year, month, categories],
  );

  const activeCategories = useMemo(
    () => categories.filter((c) => c.type !== 'transfer' && (!c.is_archived || averageMonths(matrix.byCategory[c.id], keys) !== 0)),
    [categories, matrix, keys],
  );

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        {[1, 2, 3].map((i) => <div key={i} className={`h-80 animate-pulse ${PANEL}`} />)}
      </div>
    );
  }

  if (failed) {
    return (
      <DataUnavailable
        eyebrow={`${months} months to ${getMonthName(month)} ${year}`}
        title="Trends unavailable"
        message="Couldn't load transactions for this range, so no trends are shown."
        onRetry={() => failed.refetch()}
        retrying={failed.isFetching}
      />
    );
  }

  const summary = computeTrendSummary(data.series.filter((m) => m.spending !== 0 || m.income !== 0));
  const caption = summary.monthCount
    ? `Average ${money(summary.average)}/month · highest ${summary.highest.label} (${money(summary.highest.spent)}) · lowest ${summary.lowest.label} (${money(summary.lowest.spent)}).`
    : '';
  const overallRate = data.incomeTotal > 0 ? Math.round((data.savedTotal / data.incomeTotal) * 100) : null;

  const selectedCategory = selection.kind === 'category' ? categories.find((c) => c.id === selection.id) : null;
  const lineColor = selection.kind === 'type'
    ? (selection.id === 'saved' ? MIX_COLORS.saved : TYPE_COLORS[selection.id] ?? CHART_MUTED)
    : selectedCategory?.color || CATEGORY_FALLBACK_COLOR;
  const selectionName = selection.kind === 'type'
    ? (selection.id === 'saved' ? 'Saved' : `All ${CATEGORY_TYPE_LABELS[selection.id]?.toLowerCase() ?? selection.id}`)
    : selectedCategory?.name ?? matrix.meta[selection.id]?.name ?? 'Category';

  const pickCategory = (id) => {
    setSelectionValue(`cat:${id}`);
    document.getElementById('trend-category')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  return (
    <div className="space-y-6">
      <TrendChart range={range} monthlyData={data.series} caption={caption} />

      {/* Where income went + savings rate (two charts: one axis each) */}
      <section className={PANEL} aria-labelledby="trend-mix">
        <h3 id="trend-mix" className={PANEL_TITLE}>Where income went</h3>
        <p className={`${PANEL_SUB} mb-4`}>
          Needs, wants and savings each month. Saved includes budget lines and money moved to savings accounts.
        </p>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data.mixRows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
            <YAxis tickFormatter={formatPreMaskedAxisDollar} {...AXIS} width={64} />
            <Tooltip
              cursor={{ fill: 'rgba(120,120,120,0.08)' }}
              content={<ChartTooltip extra={(row) => (
                <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
                  Savings rate {row?.rate == null ? '—' : `${Math.round(row.rate)}%`}
                </p>
              )} />}
              labelFormatter={(_, p) => p?.[0]?.payload?.fullLabel}
            />
            <Legend {...legendProps(['needs', 'wants', 'saved'])} />
            <Bar dataKey="needs" name="Needs" stackId="mix" fill={MIX_COLORS.needs} stroke={CHART_SURFACE} strokeWidth={2} />
            <Bar dataKey="wants" name="Wants" stackId="mix" fill={MIX_COLORS.wants} stroke={CHART_SURFACE} strokeWidth={2} />
            <Bar dataKey="saved" name="Saved" stackId="mix" fill={MIX_COLORS.saved} stroke={CHART_SURFACE} strokeWidth={2} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-semibold text-stone-900 dark:text-stone-100">Savings rate</h4>
          <p className={PANEL_SUB}>{overallRate == null ? 'No income in range' : `${overallRate}% of income over the range`}</p>
        </div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data.mixRows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v) => `${Math.round(v)}%`} {...AXIS} width={64} />
            <Tooltip content={<PercentTooltip />} labelFormatter={(_, p) => p?.[0]?.payload?.fullLabel} />
            <ReferenceLine y={0} stroke={CHART_AXIS} />
            <Line type="monotone" dataKey="rate" name="Savings rate" stroke={MIX_COLORS.saved} strokeWidth={2} connectNulls={false} dot={{ r: 4, strokeWidth: 2, fill: CHART_SURFACE }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Fixed vs flexible */}
      <section className={PANEL} aria-labelledby="trend-fixed">
        <h3 id="trend-fixed" className={PANEL_TITLE}>Fixed bills vs flexible spending</h3>
        <p className={`${PANEL_SUB} mb-4`}>
          Bills are recurring transactions or the same payee charging the same amount in 3+ months.
          Averages {money(data.fixedAvg)} fixed and {money(data.flexAvg)} flexible per month.
        </p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.fixedRows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
            <YAxis tickFormatter={formatPreMaskedAxisDollar} {...AXIS} width={64} />
            <Tooltip cursor={{ fill: 'rgba(120,120,120,0.08)' }} content={<ChartTooltip />} labelFormatter={(_, p) => p?.[0]?.payload?.fullLabel} />
            <Legend {...legendProps(['fixed', 'flexible'])} />
            <Bar dataKey="fixed" name="Fixed bills" stackId="ff" fill={FIXED_FLEX_COLORS.fixed} stroke={CHART_SURFACE} strokeWidth={2} />
            <Bar dataKey="flexible" name="Flexible" stackId="ff" fill={FIXED_FLEX_COLORS.flexible} stroke={CHART_SURFACE} strokeWidth={2} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* Category trend */}
      <section id="trend-category" className={`${PANEL} scroll-mt-24`} aria-labelledby="trend-category-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="trend-category-title" className={PANEL_TITLE}>{selectionName}</h3>
            <p className={PANEL_SUB}>
              Monthly total; the dashed line is the {months}-month average ({money(categoryTrend.rawAverage)}).
            </p>
          </div>
          <select
            value={selectionValue}
            onChange={(e) => setSelectionValue(e.target.value)}
            aria-label="Category to chart"
            className="rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2 text-sm text-stone-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100"
          >
            <optgroup label="Totals">
              <option value="type:needs">All needs</option>
              <option value="type:wants">All wants</option>
              <option value="type:saved">Saved</option>
              <option value="type:income">All income</option>
            </optgroup>
            {['income', 'needs', 'wants', 'savings'].map((type) => {
              const list = activeCategories.filter((c) => c.type === type);
              return list.length > 0 && (
                <optgroup key={type} label={CATEGORY_TYPE_LABELS[type]}>
                  {list.map((c) => <option key={c.id} value={`cat:${c.id}`}>{c.name}{c.is_archived ? ' (Archived)' : ''}</option>)}
                </optgroup>
              );
            })}
          </select>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={categoryTrend.rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={CHART_GRID} vertical={false} />
            <XAxis dataKey="label" {...AXIS} interval="preserveStartEnd" />
            <YAxis tickFormatter={formatPreMaskedAxisDollar} {...AXIS} width={64} />
            <Tooltip content={<ChartTooltip />} labelFormatter={(_, p) => p?.[0]?.payload?.fullLabel} />
            <ReferenceLine y={categoryTrend.average} stroke={CHART_AXIS} strokeDasharray="6 4" />
            <Line type="monotone" dataKey="value" name={selectionName} stroke={lineColor} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: CHART_SURFACE }} activeDot={{ r: 6 }} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* Biggest changes */}
      <section className={PANEL} aria-labelledby="trend-changes">
        <h3 id="trend-changes" className={PANEL_TITLE}>Biggest changes</h3>
        <p className={`${PANEL_SUB} mb-4`}>
          Monthly average for the 3 months to {getMonthName(month)} {year} vs the 3 months before. Pick one to chart it.
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          {[
            { title: 'Rising', rows: changes.risers, empty: 'Nothing rose by more than $10/month.' },
            { title: 'Falling', rows: changes.fallers, empty: 'Nothing fell by more than $10/month.' },
          ].map((col) => (
            <div key={col.title}>
              <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-stone-500 dark:text-stone-400">{col.title}</h4>
              {col.rows.length === 0 ? (
                <p className="text-sm text-stone-500 dark:text-stone-400">{col.empty}</p>
              ) : (
                <ul className="space-y-1">
                  {col.rows.map((row) => (
                    <li key={row.categoryId}>
                      <button
                        type="button"
                        onClick={() => pickCategory(row.categoryId)}
                        className="-mx-2 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-stone-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-stone-700/40"
                      >
                        <CategoryWell category={{ name: row.name, color: row.color }} className="h-8 w-8 text-xs" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-stone-900 dark:text-stone-100">{row.name}</span>
                          <span className="block text-xs tabular-nums text-stone-500 dark:text-stone-400">
                            {money(row.actual)}/mo vs {money(row.compare)}/mo
                          </span>
                        </span>
                        <ChangeChip actual={row.actual} compare={row.compare} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
