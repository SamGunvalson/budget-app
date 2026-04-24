import { useMemo, useState, useEffect, useCallback } from 'react';
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
} from 'recharts';
import { toDollars, formatCurrency, formatAxisDollar, maskAccountName } from '../../utils/helpers';
import {
  getAccountBalanceHistoryOffline as getAccountBalanceHistory,
} from '../../services/offlineAware';
import { isLiabilityAccount } from '../../services/accounts';

// ─── Account-color palette ───────────────────────────────────────────────────
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

// ─── Range presets ────────────────────────────────────────────────────────────
const RANGE_OPTIONS = [
  { key: '1m', label: '1M', pastMonths: 1, futureMonths: 1 },
  { key: '3m', label: '3M', pastMonths: 2, futureMonths: 1 },
  { key: '6m', label: '6M', pastMonths: 4, futureMonths: 2 },
  { key: '1y', label: '1Y', pastMonths: 9, futureMonths: 3 },
  { key: 'all', label: 'All', pastMonths: null, futureMonths: 6 },
];

const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(dateStr, includeYear = false) {
  const [y, m, d] = dateStr.split('-');
  const base = `${SHORT_MONTHS[Number(m)]} ${Number(d)}`;
  return includeYear ? `${base} '${y.slice(2)}` : base;
}

// ─── Custom tooltip ──────────────────────────────────────────────────────────
function CashflowTooltip({ active, payload, label, accountMap }) {
  if (!active || !payload?.length) return null;

  // Merge actual + projected entries for the same account into one line
  const merged = new Map();
  for (const p of payload) {
    if (p.value == null) continue;
    const baseKey = p.dataKey.replace(/_proj$/, '');
    const isProj = p.dataKey.endsWith('_proj');
    if (!merged.has(baseKey)) {
      merged.set(baseKey, { color: p.color, value: p.value, projected: isProj });
    } else if (!merged.get(baseKey).value && p.value != null) {
      // prefer whichever has a real value
      merged.set(baseKey, { color: p.color, value: p.value, projected: isProj });
    }
  }

  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-4 py-3 shadow-lg shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="mb-1.5 text-sm font-semibold text-stone-700 dark:text-stone-300">{label ? formatDateLabel(label, true) : ''}</p>
      {[...merged.entries()].map(([key, { color, value, projected }]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {key === 'total' ? 'Total' : maskAccountName(accountMap[key] || key)}
            {projected ? ' (proj)' : ''}:
          </span>
          <span className={`text-sm font-bold ${value < 0 ? 'text-red-600 dark:text-red-400' : 'text-stone-800 dark:text-stone-200'}`}>
            {value < 0 ? '−' : ''}{formatCurrency(Math.abs(Math.round(value * 100)))}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * CashflowChart — per-account line chart showing daily/weekly balance over time.
 *
 * Props:
 *  - accounts: Array<{ id, name, type }> — all available accounts
 *  - selectedAccountIds: string[] — which accounts to chart
 *  - playgroundItems: Array<{ type, accountId, toAccountId, amount, date }> — hypothetical transactions
 */
export default function CashflowChart({ accounts = [], selectedAccountIds = [], playgroundItems = [] }) {
  const [range, setRange] = useState('3m');
  const [chartData, setChartData] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Account id → name map for tooltip
  const accountMap = useMemo(() => {
    const m = {};
    for (const a of accounts) m[a.id] = a.name;
    return m;
  }, [accounts]);

  // Set of liability account IDs — their balances need to be negated for display
  const liabilityIds = useMemo(() => {
    const s = new Set();
    for (const a of accounts) if (isLiabilityAccount(a.type)) s.add(a.id);
    return s;
  }, [accounts]);

  const now = useMemo(() => new Date(), []);
  const todayStr = useMemo(() =>
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
  [now]);

  const { startDate, endDate } = useMemo(() => {
    const preset = RANGE_OPTIONS.find((o) => o.key === range) || RANGE_OPTIONS[1];
    const e = new Date(now);
    e.setMonth(e.getMonth() + preset.futureMonths);
    let s;
    if (preset.pastMonths === null) {
      // "All" — go back 10 years as a practical maximum; the service
      // will only return data from the earliest transaction anyway.
      s = new Date(now);
      s.setFullYear(s.getFullYear() - 10);
    } else {
      s = new Date(now);
      s.setMonth(s.getMonth() - preset.pastMonths);
    }
    return {
      startDate: `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`,
      endDate: `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, '0')}-${String(e.getDate()).padStart(2, '0')}`,
    };
  }, [range, now]);

  const loadData = useCallback(async () => {
    if (!selectedAccountIds.length) { setChartData([]); return; }
    setIsLoading(true);
    try {
      const series = await getAccountBalanceHistory({
        accountIds: selectedAccountIds,
        startDate,
        endDate,
      });
      setChartData(series);
    } catch {
      setChartData([]);
    } finally {
      setIsLoading(false);
    }
  }, [selectedAccountIds, startDate, endDate]);

  useEffect(() => { loadData(); }, [loadData]);

  // Transform for Recharts: split each account into actual (solid) and projected (dashed) series
  // Playground items are overlaid on the projected series from their date onward.
  const data = useMemo(() => {
    return chartData.map((pt) => {
      const row = { date: pt.date };
      const isFuture = pt.date > todayStr;
      const isToday = pt.date === todayStr;
      let total = 0;
      let totalProjOffset = 0;
      for (const id of selectedAccountIds) {
        const raw = toDollars(pt.balances?.[id] ?? 0);
        const val = liabilityIds.has(id) ? -raw : raw;

        // Accumulate playground offsets for this account at this chart date.
        // Offsets work in display-space (after liability negation) so the
        // formula is uniform: expense/transfer-from = −amount, income/transfer-to = +amount.
        let projOffset = 0;
        if ((isFuture || isToday) && playgroundItems.length) {
          for (const item of playgroundItems) {
            if (!item.date || !item.amount || item.date > pt.date) continue;
            const amtDollars = parseFloat(item.amount) || 0;
            if (amtDollars === 0) continue;
            if (item.type === 'expense' && item.accountId === id) projOffset -= amtDollars;
            else if (item.type === 'income' && item.accountId === id) projOffset += amtDollars;
            else if (item.type === 'transfer') {
              if (item.accountId === id) projOffset -= amtDollars;
              if (item.toAccountId === id) projOffset += amtDollars;
            }
          }
        }

        // Actual series: past + today; Projected series: today + future
        // Today appears in both so the lines connect.
        row[id] = isFuture ? null : val;
        row[`${id}_proj`] = (isFuture || isToday) ? val + projOffset : null;
        total += val;
        totalProjOffset += projOffset;
      }
      if (selectedAccountIds.length > 1) {
        row.total = isFuture ? null : total;
        row.total_proj = (isFuture || isToday) ? total + totalProjOffset : null;
      }
      return row;
    });
  }, [chartData, selectedAccountIds, liabilityIds, todayStr, playgroundItems]);

  // Whether the data spans multiple years — used for tick formatting
  const multiYear = useMemo(() => {
    if (data.length < 2) return false;
    return data[0].date.slice(0, 4) !== data[data.length - 1].date.slice(0, 4);
  }, [data]);

  const tickFormatter = useCallback(
    (dateStr) => formatDateLabel(dateStr, multiYear),
    [multiYear],
  );

  // Detect negative balance regions
  const negativeRegions = useMemo(() => {
    if (!data.length) return [];
    const regions = [];
    let regionStart = null;
    for (const pt of data) {
      const hasNegative = selectedAccountIds.some((id) => (pt[id] ?? pt[`${id}_proj`]) < 0);
      if (hasNegative && !regionStart) regionStart = pt.date;
      if (!hasNegative && regionStart) {
        regions.push({ x1: regionStart, x2: pt.date });
        regionStart = null;
      }
    }
    if (regionStart) regions.push({ x1: regionStart, x2: data[data.length - 1].date });
    return regions;
  }, [data, selectedAccountIds]);

  const tickInterval = useMemo(() => {
    const n = data.length;
    if (n <= 14) return 0;
    if (n <= 31) return 1;
    if (n <= 90) return 3;
    if (n <= 180) return 6;
    return Math.floor(n / 20);
  }, [data]);

  if (isLoading) {
    return (
      <div className="mt-4">
        <div className="h-56 animate-pulse rounded-xl bg-stone-100 dark:bg-stone-700/50" />
      </div>
    );
  }

  if (!selectedAccountIds.length) {
    return (
      <p className="mt-4 py-10 text-center text-sm text-stone-400 dark:text-stone-500">
        Select one or more accounts above to view cashflow.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {/* Header row */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Account Balance Over Time
          </p>
          {/* Legend */}
          <div className="hidden sm:flex items-center gap-3">
            {selectedAccountIds.map((id, i) => (
              <div key={id} className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length] }} />
                <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400">
                  {maskAccountName(accountMap[id] || 'Unknown')}
                </span>
              </div>
            ))}
          </div>
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
                  ? 'bg-teal-500 text-white shadow-sm shadow-teal-200/50'
                  : 'text-stone-600 hover:bg-white dark:text-stone-400 dark:hover:bg-stone-600'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      {data.length === 0 ? (
        <p className="py-10 text-center text-sm text-stone-400 dark:text-stone-500">
          No data for this period.
        </p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <LineChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
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
              tickFormatter={formatAxisDollar}
              tick={{ fill: '#78716c', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={72}
            />
            <Tooltip content={<CashflowTooltip accountMap={accountMap} />} />

            {/* Today reference line */}
            {todayStr && (
              <ReferenceLine
                x={todayStr}
                stroke="#a8a29e"
                strokeDasharray="3 3"
                strokeWidth={1.5}
                label={{ value: 'Today', position: 'insideTopRight', fontSize: 10, fill: '#a8a29e' }}
              />
            )}

            {/* Negative balance warning regions */}
            {negativeRegions.map((r, i) => (
              <ReferenceArea
                key={i}
                x1={r.x1}
                x2={r.x2}
                fill="#ef4444"
                fillOpacity={0.08}
                strokeOpacity={0}
              />
            ))}

            {/* Per-account lines — solid for actual, dashed for projected */}
            {selectedAccountIds.map((id, i) => {
              const color = ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
              return [
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={maskAccountName(accountMap[id] || 'Unknown')}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: color }}
                />,
                <Line
                  key={`${id}_proj`}
                  type="monotone"
                  dataKey={`${id}_proj`}
                  name={`${maskAccountName(accountMap[id] || 'Unknown')} (projected)`}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  strokeOpacity={0.6}
                  dot={false}
                  connectNulls={false}
                  activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: color }}
                />,
              ];
            })}

            {/* Total line (when multiple accounts) — solid actual + dashed projected */}
            {selectedAccountIds.length > 1 && [
              <Line
                key="total"
                type="monotone"
                dataKey="total"
                name="Total"
                stroke="#78716c"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                connectNulls={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#78716c' }}
              />,
              <Line
                key="total_proj"
                type="monotone"
                dataKey="total_proj"
                name="Total (projected)"
                stroke="#78716c"
                strokeWidth={2}
                strokeDasharray="2 2"
                strokeOpacity={0.5}
                dot={false}
                connectNulls={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#78716c' }}
              />,
            ]}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
