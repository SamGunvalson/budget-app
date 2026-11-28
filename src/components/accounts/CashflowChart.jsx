import { useMemo, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  ReferenceArea,
  ReferenceDot,
} from 'recharts';
import { toDollars, formatPreMaskedDollars, formatPreMaskedAxisDollar, maskAccountName } from '../../utils/helpers';
import { isLiabilityAccount } from '../../services/accounts';
import { CASHFLOW_RANGE_OPTIONS } from '../../hooks/useCashflowScenario';
import { CHART_AXIS, CHART_NEGATIVE, SERIES_COLORS } from '../../constants/chartColors';

// ─── Colors ──────────────────────────────────────────────────────────────────
// Cash total is the headline line, so it uses the app's forest/sage income
// color (a CSS variable that flips with the theme). Account lines use muted
// mid-tones that read in both modes and avoid gold/orange (action/warning).
const CASH_COLOR = 'var(--app-income)';
const SOFT = 'var(--app-soft)';
const PANEL = 'var(--app-panel)';
const LINE = 'var(--app-line)';
const ACCOUNT_COLORS = SERIES_COLORS;

const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(dateStr, includeYear = false) {
  const [y, m, d] = dateStr.split('-');
  const base = `${SHORT_MONTHS[Number(m)]} ${Number(d)}`;
  return includeYear ? `${base} '${y.slice(2)}` : base;
}

function signedPreMasked(value) {
  return `${value < 0 ? '−' : ''}${formatPreMaskedDollars(Math.abs(value))}`;
}

/**
 * X-axis ticks on calendar boundaries rather than every Nth row, so labels
 * stay meaningful at any width: weekly for short ranges, the 1st and 15th
 * for medium ones, month starts beyond that. Recharts then drops any that
 * would still collide (see `interval` / `minTickGap` on the axis).
 */
function buildTicks(dates) {
  if (dates.length <= 1) return { ticks: dates, mode: 'day' };
  if (dates.length <= 75) return { ticks: dates.filter((_, i) => i % 7 === 0), mode: 'day' };
  if (dates.length <= 130) {
    return { ticks: dates.filter((d) => d.endsWith('-01') || d.endsWith('-15')), mode: 'day' };
  }
  return { ticks: dates.filter((d) => d.endsWith('-01')), mode: 'month' };
}

function LegendSwatch({ color, dashed = false, opacity = 1 }) {
  return (
    <svg width="16" height="6" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="3" x2="15" y2="3" stroke={color} strokeOpacity={opacity} strokeWidth="2"
        strokeDasharray={dashed ? '3 3' : undefined} strokeLinecap="round" />
    </svg>
  );
}

// ─── Custom tooltip ──────────────────────────────────────────────────────────
function CashflowTooltip({ active, payload, label, accountMap, settlementsByDate }) {
  if (!active || !payload?.length) return null;

  // Merge actual + projected entries for the same series into one line.
  const merged = new Map();
  for (const p of payload) {
    if (p.value == null) continue;
    const key = String(p.dataKey).replace(/_proj$/, '');
    if (!merged.has(key)) merged.set(key, { color: p.stroke ?? p.color, value: p.value });
  }
  const settlements = settlementsByDate[label] || [];

  const labelFor = (key) => {
    if (key === 'cash') return 'Cash total';
    if (key === 'cash_base') return 'Without test items';
    return maskAccountName(accountMap[key]?.name || key);
  };

  return (
    <div className="max-w-xs rounded-xl border border-stone-200/60 bg-white px-3.5 py-2.5 shadow-lg shadow-stone-900/10 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500 dark:text-stone-400">
        {label ? formatDateLabel(label, true) : ''}
      </p>
      <div className="space-y-0.5">
        {[...merged.entries()].map(([key, { color, value }]) => (
          <div key={key} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="min-w-0 flex-1 truncate text-xs text-soft">{labelFor(key)}</span>
            <span className={`text-sm font-semibold tabular-nums ${value < 0 ? 'text-red-600 dark:text-red-400' : 'text-ink'}`}>
              {signedPreMasked(value)}
            </span>
          </div>
        ))}
      </div>
      {settlements.length > 0 && (
        <div className="mt-2 border-t border-stone-200/60 pt-2 dark:border-stone-700/60">
          {settlements.map((s) => (
            <p key={`${s.cardId}-${s.closeDate}`} className="text-xs text-soft">
              {maskAccountName(accountMap[s.cardId]?.name || 'Card')} statement paid from{' '}
              {maskAccountName(accountMap[s.payerId]?.name || 'account')}:{' '}
              <span className="font-semibold text-ink">{formatPreMaskedDollars(toDollars(s.amount))}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * CashflowChart — balances over time for the chosen accounts, plus the total
 * cash line with card statements settled and test items applied.
 *
 * Props:
 *  - accounts: account rows (for names and asset/liability sign)
 *  - selectableAccounts: open accounts offered as toggles below the chart
 *  - chartAccountIds: accounts to draw individually
 *  - onToggleAccount(id) / onToggleAll(): change chartAccountIds
 *  - result: buildCashflowScenario() output, or null
 *  - hasItems: whether any test items are switched on (shows the baseline)
 *  - todayStr: YYYY-MM-DD
 *  - range / onRangeChange: range preset key
 *  - isLoading
 */
export default function CashflowChart({
  accounts = [],
  selectableAccounts = [],
  chartAccountIds = [],
  onToggleAccount,
  onToggleAll,
  result = null,
  hasItems = false,
  todayStr,
  range,
  onRangeChange,
  isLoading = false,
}) {
  const accountMap = useMemo(() => Object.fromEntries(accounts.map((a) => [a.id, a])), [accounts]);
  const balances = result?.scenario.balances;
  const drawnIds = useMemo(
    () => chartAccountIds.filter((id) => balances?.[id]),
    [chartAccountIds, balances],
  );
  // Stable color per account (by position in the selectable list), so a
  // line keeps its color when other accounts are toggled on or off.
  const colorFor = useMemo(() => {
    const map = {};
    selectableAccounts.forEach((a, i) => { map[a.id] = ACCOUNT_COLORS[i % ACCOUNT_COLORS.length]; });
    return (id) => map[id] ?? ACCOUNT_COLORS[0];
  }, [selectableAccounts]);
  const showCash = Boolean(result?.scenario.cash && Object.values(result.roles).includes('cash'));

  // Chart rows. Raw-sign cents → display sign (liabilities negative), then
  // masked exactly once by toDollars(); tooltip/axis use formatPreMasked*.
  const data = useMemo(() => {
    if (!result) return [];
    const { dates, scenario, baseline } = result;
    return dates.map((date, i) => {
      const row = { date };
      const isPast = date <= todayStr;
      const isFuture = date >= todayStr; // today is in both so lines connect
      for (const id of drawnIds) {
        const sign = isLiabilityAccount(accountMap[id]?.type) ? -1 : 1;
        const value = toDollars(sign * scenario.balances[id][i]);
        row[id] = isPast ? value : null;
        row[`${id}_proj`] = isFuture ? value : null;
      }
      if (showCash) {
        const cash = toDollars(scenario.cash[i]);
        row.cash = isPast ? cash : null;
        row.cash_proj = isFuture ? cash : null;
        if (hasItems) row.cash_base = isFuture ? toDollars(baseline.cash[i]) : null;
      }
      return row;
    });
  }, [result, drawnIds, accountMap, todayStr, showCash, hasItems]);

  const settlementsByDate = useMemo(() => {
    const map = {};
    for (const s of result?.scenario.settlements ?? []) {
      if (s.amount <= 0) continue;
      (map[s.paymentDate] ||= []).push(s);
    }
    return map;
  }, [result]);

  // Future stretches where scenario cash is below the cushion.
  const belowCushionRegions = useMemo(() => {
    if (!result || !showCash) return [];
    const { dates, scenario, summary } = result;
    const regions = [];
    let start = null;
    dates.forEach((date, i) => {
      const below = date >= todayStr && scenario.cash[i] < summary.cushion;
      if (below && !start) start = date;
      if (!below && start) {
        regions.push({ x1: start, x2: date });
        start = null;
      }
    });
    if (start) regions.push({ x1: start, x2: dates[dates.length - 1] });
    return regions;
  }, [result, showCash, todayStr]);

  const multiYear = data.length > 1 && data[0].date.slice(0, 4) !== data[data.length - 1].date.slice(0, 4);
  const { ticks, mode: tickMode } = useMemo(() => buildTicks(data.map((r) => r.date)), [data]);
  const tickFormatter = useCallback((dateStr) => {
    if (tickMode === 'month') {
      const [y, m] = dateStr.split('-');
      // Show the year on January (and the first tick) when the range spans years.
      return multiYear && (m === '01' || dateStr === ticks[0])
        ? `${SHORT_MONTHS[Number(m)]} '${y.slice(2)}`
        : SHORT_MONTHS[Number(m)];
    }
    return formatDateLabel(dateStr, false);
  }, [tickMode, multiYear, ticks]);

  const lowest = result?.summary.lowest;
  const cushion = result?.summary.cushion ?? 0;

  const allSelected = selectableAccounts.length > 0 && chartAccountIds.length >= selectableAccounts.length
    && selectableAccounts.every((a) => chartAccountIds.includes(a.id));

  return (
    <section aria-labelledby="cashflow-chart-title" className="space-y-2">
      <h2
        id="cashflow-chart-title"
        className="px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600 dark:text-stone-300"
      >
        Balance over time
      </h2>

      <div className="rounded-2xl border border-stone-200/60 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-700/60 dark:bg-stone-800">
        {/* Legend + range toggle */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-soft">
            {showCash && (
              <span className="flex items-center gap-1.5"><LegendSwatch color={CASH_COLOR} />Cash total</span>
            )}
            {showCash && hasItems && (
              <span className="flex items-center gap-1.5"><LegendSwatch color={SOFT} dashed opacity={0.8} />Without test items</span>
            )}
            {(showCash || drawnIds.length > 0) && (
              <span className="flex items-center gap-1.5"><LegendSwatch color={SOFT} dashed opacity={0.6} />Projected</span>
            )}
          </div>
          <div className="inline-flex rounded-lg border border-stone-200/60 bg-stone-50 p-0.5 dark:border-stone-700/60 dark:bg-stone-700/30">
            {CASHFLOW_RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                aria-pressed={range === opt.key}
                onClick={() => onRangeChange?.(opt.key)}
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

        {isLoading ? (
          <div className="h-60 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-700/50" />
        ) : data.length === 0 ? (
          <p className="py-10 text-center text-sm text-stone-400 dark:text-stone-500">
            {showCash || drawnIds.length
              ? 'No data for this period.'
              : 'Pick accounts below, or mark an account as cash, to see a forecast.'}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={data} margin={{ top: 18, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={LINE} strokeOpacity={0.7} />
              <XAxis
                dataKey="date"
                ticks={ticks}
                tickFormatter={tickFormatter}
                tick={{ fill: CHART_AXIS, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                interval="equidistantPreserveStart"
                minTickGap={12}
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
                content={<CashflowTooltip accountMap={accountMap} settlementsByDate={settlementsByDate} />}
                cursor={{ stroke: LINE, strokeWidth: 1 }}
              />

              {belowCushionRegions.map((r) => (
                <ReferenceArea key={r.x1} x1={r.x1} x2={r.x2} fill={CHART_NEGATIVE} fillOpacity={0.06} strokeOpacity={0} />
              ))}

              <ReferenceLine
                x={todayStr}
                stroke={SOFT}
                strokeOpacity={0.4}
                strokeWidth={1}
                label={{ value: 'Today', position: 'top', offset: 6, fontSize: 10, fontWeight: 600, fill: CHART_AXIS }}
              />
              {showCash && cushion > 0 && (
                <ReferenceLine
                  y={toDollars(cushion)}
                  stroke={CHART_NEGATIVE}
                  strokeOpacity={0.45}
                  strokeDasharray="4 4"
                  label={{ value: 'Cushion', position: 'insideBottomLeft', fontSize: 10, fill: CHART_NEGATIVE }}
                />
              )}

              {drawnIds.map((id) => {
                const color = colorFor(id);
                const name = maskAccountName(accountMap[id]?.name || 'Unknown');
                return [
                  <Line key={id} type="monotone" dataKey={id} name={name} stroke={color} strokeWidth={1.75}
                    dot={false} connectNulls={false} activeDot={{ r: 3.5, strokeWidth: 2, fill: PANEL, stroke: color }} />,
                  <Line key={`${id}_proj`} type="monotone" dataKey={`${id}_proj`} name={`${name} (projected)`} stroke={color}
                    strokeWidth={1.75} strokeDasharray="4 4" strokeOpacity={0.55} dot={false} connectNulls={false}
                    activeDot={{ r: 3.5, strokeWidth: 2, fill: PANEL, stroke: color }} />,
                ];
              })}

              {showCash && hasItems && (
                <Line key="cash_base" type="stepAfter" dataKey="cash_base" name="Cash without test items" stroke={SOFT}
                  strokeOpacity={0.8} strokeWidth={1.5} strokeDasharray="3 3" dot={false} connectNulls={false} activeDot={false} />
              )}
              {showCash && [
                <Line key="cash" type="stepAfter" dataKey="cash" name="Cash total" stroke={CASH_COLOR} strokeWidth={2.5}
                  dot={false} connectNulls={false} activeDot={{ r: 4.5, strokeWidth: 2, fill: PANEL, stroke: CASH_COLOR }} />,
                <Line key="cash_proj" type="stepAfter" dataKey="cash_proj" name="Cash total (projected)" stroke={CASH_COLOR}
                  strokeWidth={2.5} strokeDasharray="4 4" strokeOpacity={0.6} dot={false} connectNulls={false}
                  activeDot={{ r: 4.5, strokeWidth: 2, fill: PANEL, stroke: CASH_COLOR }} />,
              ]}

              {/* Card statement payments on the cash line */}
              {showCash && result && Object.keys(settlementsByDate).map((date) => {
                const i = result.dates.indexOf(date);
                if (i === -1) return null;
                return (
                  <ReferenceDot key={`settle-${date}`} x={date} y={toDollars(result.scenario.cash[i])} r={3.5}
                    fill={PANEL} stroke={SOFT} strokeWidth={1.75} />
                );
              })}

              {showCash && lowest && (
                <ReferenceDot x={lowest.date} y={toDollars(lowest.amount)} r={4.5} fill={CASH_COLOR} stroke={PANEL} strokeWidth={2}
                  label={{ value: 'Lowest', position: 'bottom', offset: 8, fontSize: 10, fontWeight: 600, fill: CHART_AXIS }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        )}

        {/* Account toggles — also the legend for the account lines */}
        {selectableAccounts.length > 0 && (
          <div className="mt-4 border-t border-stone-200/60 pt-4 dark:border-stone-700/60">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500 dark:text-stone-400">
                Accounts on chart
              </p>
              <button
                type="button"
                onClick={() => onToggleAll?.()}
                className="text-xs font-medium text-stone-500 transition-colors hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
              >
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectableAccounts.map((acct) => {
                const isSelected = chartAccountIds.includes(acct.id);
                return (
                  <button
                    key={acct.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onToggleAccount?.(acct.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      isSelected
                        ? 'border-stone-300 bg-stone-100 text-ink dark:border-stone-600 dark:bg-stone-700/60'
                        : 'border-stone-200/60 text-stone-500 hover:border-stone-400 hover:text-stone-800 dark:border-stone-700/60 dark:text-stone-400 dark:hover:border-stone-500 dark:hover:text-stone-200'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className="h-2 w-2 shrink-0 rounded-full border"
                      style={isSelected
                        ? { backgroundColor: colorFor(acct.id), borderColor: colorFor(acct.id) }
                        : { borderColor: 'currentColor', opacity: 0.5 }}
                    />
                    {maskAccountName(acct.name)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
