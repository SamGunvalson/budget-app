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

// ─── Colors ──────────────────────────────────────────────────────────────────
const ACCOUNT_COLORS = [
  '#0d9488', // teal-600
  '#0891b2', // cyan-600
  '#2563eb', // blue-600
  '#7c3aed', // violet-600
  '#db2777', // pink-600
  '#ea580c', // orange-600
  '#16a34a', // green-600
  '#ca8a04', // yellow-600
];
const CASH_COLOR = '#d97706'; // amber-600
const BASELINE_COLOR = '#a8a29e'; // stone-400

const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(dateStr, includeYear = false) {
  const [y, m, d] = dateStr.split('-');
  const base = `${SHORT_MONTHS[Number(m)]} ${Number(d)}`;
  return includeYear ? `${base} '${y.slice(2)}` : base;
}

function signedPreMasked(value) {
  return `${value < 0 ? '−' : ''}${formatPreMaskedDollars(Math.abs(value))}`;
}

// ─── Custom tooltip ──────────────────────────────────────────────────────────
function CashflowTooltip({ active, payload, label, accountMap, settlementsByDate }) {
  if (!active || !payload?.length) return null;

  // Merge actual + projected entries for the same series into one line.
  const merged = new Map();
  for (const p of payload) {
    if (p.value == null) continue;
    const key = String(p.dataKey).replace(/_proj$/, '');
    if (!merged.has(key)) merged.set(key, { color: p.color, value: p.value });
  }
  const settlements = settlementsByDate[label] || [];

  const labelFor = (key) => {
    if (key === 'cash') return 'Cash total';
    if (key === 'cash_base') return 'Cash without test items';
    return maskAccountName(accountMap[key]?.name || key);
  };

  return (
    <div className="max-w-xs rounded-xl border border-stone-200/60 bg-white px-4 py-3 shadow-lg shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="mb-1.5 text-sm font-semibold text-stone-700 dark:text-stone-300">{label ? formatDateLabel(label, true) : ''}</p>
      {[...merged.entries()].map(([key, { color, value }]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs text-stone-500 dark:text-stone-400">{labelFor(key)}:</span>
          <span className={`text-sm font-bold ${value < 0 ? 'text-red-600 dark:text-red-400' : 'text-stone-800 dark:text-stone-200'}`}>
            {signedPreMasked(value)}
          </span>
        </div>
      ))}
      {settlements.length > 0 && (
        <div className="mt-2 border-t border-stone-100 pt-2 dark:border-stone-700">
          {settlements.map((s) => (
            <p key={`${s.cardId}-${s.closeDate}`} className="text-xs text-stone-500 dark:text-stone-400">
              {maskAccountName(accountMap[s.cardId]?.name || 'Card')} statement paid from{' '}
              {maskAccountName(accountMap[s.payerId]?.name || 'account')}:{' '}
              <span className="font-semibold text-stone-700 dark:text-stone-200">{formatPreMaskedDollars(toDollars(s.amount))}</span>
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
 *  - chartAccountIds: accounts to draw individually
 *  - result: buildCashflowScenario() output, or null
 *  - hasItems: whether any test items are switched on (shows the baseline)
 *  - todayStr: YYYY-MM-DD
 *  - range / onRangeChange: range preset key
 *  - isLoading
 */
export default function CashflowChart({
  accounts = [],
  chartAccountIds = [],
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
  const tickFormatter = useCallback((dateStr) => formatDateLabel(dateStr, multiYear), [multiYear]);
  const n = data.length;
  const tickInterval = n <= 14 ? 0 : n <= 31 ? 1 : n <= 90 ? 3 : n <= 180 ? 6 : Math.floor(n / 20);

  const lowest = result?.summary.lowest;
  const cushion = result?.summary.cushion ?? 0;

  return (
    <div className="mt-4">
      {/* Header row */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Balance Over Time
          </p>
          <div className="hidden flex-wrap items-center gap-3 sm:flex">
            {showCash && (
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 rounded" style={{ backgroundColor: CASH_COLOR }} />
                <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400">Cash total</span>
              </span>
            )}
            {showCash && hasItems && (
              <span className="flex items-center gap-1">
                <span className="h-0.5 w-3 rounded border-t border-dashed" style={{ borderColor: BASELINE_COLOR }} />
                <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400">Without test items</span>
              </span>
            )}
            {drawnIds.map((id, i) => (
              <span key={id} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }} />
                <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400">
                  {maskAccountName(accountMap[id]?.name || 'Unknown')}
                </span>
              </span>
            ))}
          </div>
        </div>
        <div className="inline-flex rounded-lg border border-stone-200/60 bg-stone-50 p-0.5 shadow-sm dark:border-stone-700/60 dark:bg-stone-700/30">
          {CASHFLOW_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => onRangeChange?.(opt.key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                range === opt.key
                  ? 'bg-teal-500 text-white shadow-sm shadow-teal-200/50'
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
            : 'Select accounts above, or mark an account as cash, to see a forecast.'}
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" className="dark:stroke-stone-700" />
            <XAxis
              dataKey="date"
              tickFormatter={tickFormatter}
              tick={{ fill: '#78716c', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              interval={tickInterval}
            />
            <YAxis
              tickFormatter={formatPreMaskedAxisDollar}
              tick={{ fill: '#78716c', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={72}
            />
            <Tooltip content={<CashflowTooltip accountMap={accountMap} settlementsByDate={settlementsByDate} />} />

            {belowCushionRegions.map((r) => (
              <ReferenceArea key={r.x1} x1={r.x1} x2={r.x2} fill="#ef4444" fillOpacity={0.08} strokeOpacity={0} />
            ))}

            <ReferenceLine
              x={todayStr}
              stroke="#a8a29e"
              strokeDasharray="3 3"
              strokeWidth={1.5}
              label={{ value: 'Today', position: 'insideTopRight', fontSize: 10, fill: '#a8a29e' }}
            />
            {showCash && cushion > 0 && (
              <ReferenceLine
                y={toDollars(cushion)}
                stroke="#ef4444"
                strokeOpacity={0.5}
                strokeDasharray="4 4"
                label={{ value: 'Cushion', position: 'insideBottomLeft', fontSize: 10, fill: '#ef4444' }}
              />
            )}

            {drawnIds.map((id, i) => {
              const color = ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
              const name = maskAccountName(accountMap[id]?.name || 'Unknown');
              return [
                <Line key={id} type="monotone" dataKey={id} name={name} stroke={color} strokeWidth={1.5}
                  dot={false} connectNulls={false} activeDot={{ r: 3, strokeWidth: 2, fill: '#fff', stroke: color }} />,
                <Line key={`${id}_proj`} type="monotone" dataKey={`${id}_proj`} name={`${name} (projected)`} stroke={color}
                  strokeWidth={1.5} strokeDasharray="6 4" strokeOpacity={0.6} dot={false} connectNulls={false}
                  activeDot={{ r: 3, strokeWidth: 2, fill: '#fff', stroke: color }} />,
              ];
            })}

            {showCash && hasItems && (
              <Line key="cash_base" type="stepAfter" dataKey="cash_base" name="Cash without test items" stroke={BASELINE_COLOR}
                strokeWidth={1.5} strokeDasharray="3 3" dot={false} connectNulls={false} activeDot={false} />
            )}
            {showCash && [
              <Line key="cash" type="stepAfter" dataKey="cash" name="Cash total" stroke={CASH_COLOR} strokeWidth={2.5}
                dot={false} connectNulls={false} activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: CASH_COLOR }} />,
              <Line key="cash_proj" type="stepAfter" dataKey="cash_proj" name="Cash total (projected)" stroke={CASH_COLOR}
                strokeWidth={2.5} strokeDasharray="6 3" dot={false} connectNulls={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: CASH_COLOR }} />,
            ]}

            {/* Card statement payments on the cash line */}
            {showCash && result && Object.keys(settlementsByDate).map((date) => {
              const i = result.dates.indexOf(date);
              if (i === -1) return null;
              return (
                <ReferenceDot key={`settle-${date}`} x={date} y={toDollars(result.scenario.cash[i])} r={4}
                  fill="#fff" stroke="#7c3aed" strokeWidth={2} />
              );
            })}

            {showCash && lowest && (
              <ReferenceDot x={lowest.date} y={toDollars(lowest.amount)} r={5} fill={CASH_COLOR} stroke="#fff" strokeWidth={2}
                label={{ value: 'Lowest', position: 'bottom', fontSize: 10, fill: CASH_COLOR }} />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
