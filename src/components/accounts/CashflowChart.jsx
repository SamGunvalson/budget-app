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
  { key: '1m', label: '1M', months: 1 },
  { key: '3m', label: '3M', months: 3 },
  { key: '6m', label: '6M', months: 6 },
  { key: '1y', label: '1Y', months: 12 },
];

function formatDateLabel(dateStr) {
  const [, m, d] = dateStr.split('-');
  const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${SHORT_MONTHS[Number(m)]} ${Number(d)}`;
}

// ─── Custom tooltip ──────────────────────────────────────────────────────────
function CashflowTooltip({ active, payload, label, accountMap }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-4 py-3 shadow-lg shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="mb-1.5 text-sm font-semibold text-stone-700 dark:text-stone-300">{label}</p>
      {payload.filter((p) => p.value != null).map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-xs text-stone-500 dark:text-stone-400">
            {p.dataKey === 'total' ? 'Total' : maskAccountName(accountMap[p.dataKey] || p.dataKey)}:
          </span>
          <span className={`text-sm font-bold ${p.value < 0 ? 'text-red-600 dark:text-red-400' : 'text-stone-800 dark:text-stone-200'}`}>
            {p.value < 0 ? '−' : ''}{formatCurrency(Math.abs(Math.round(p.value * 100)))}
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
 *  - onSelectAccounts: (ids: string[]) => void
 */
export default function CashflowChart({ accounts = [], selectedAccountIds = [] }) {
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
    const halfMonths = Math.ceil(preset.months / 2);
    const s = new Date(now);
    s.setMonth(s.getMonth() - halfMonths);
    const e = new Date(now);
    e.setMonth(e.getMonth() + halfMonths);
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

  // Transform for Recharts: flatten balances into top-level keys
  const data = useMemo(() => {
    return chartData.map((pt) => {
      const row = { date: pt.date, label: formatDateLabel(pt.date) };
      let total = 0;
      for (const id of selectedAccountIds) {
        const raw = toDollars(pt.balances?.[id] ?? 0);
        const val = liabilityIds.has(id) ? -raw : raw;
        row[id] = val;
        total += val;
      }
      if (selectedAccountIds.length > 1) {
        row.total = total;
      }
      return row;
    });
  }, [chartData, selectedAccountIds, liabilityIds]);

  const todayLabel = useMemo(() => {
    const pt = data.find((d) => d.date === todayStr);
    return pt?.label ?? null;
  }, [data, todayStr]);

  // Detect negative balance regions
  const negativeRegions = useMemo(() => {
    if (!data.length) return [];
    const regions = [];
    let regionStart = null;
    for (const pt of data) {
      const hasNegative = selectedAccountIds.some((id) => pt[id] < 0);
      if (hasNegative && !regionStart) regionStart = pt.label;
      if (!hasNegative && regionStart) {
        regions.push({ x1: regionStart, x2: pt.label });
        regionStart = null;
      }
    }
    if (regionStart) regions.push({ x1: regionStart, x2: data[data.length - 1].label });
    return regions;
  }, [data, selectedAccountIds]);

  const tickInterval = useMemo(() => {
    const n = data.length;
    if (n <= 14) return 0;
    if (n <= 31) return 1;
    if (n <= 60) return 3;
    return Math.floor(n / 16);
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
            <Tooltip content={<CashflowTooltip accountMap={accountMap} />} />

            {/* Today reference line */}
            {todayLabel && (
              <ReferenceLine
                x={todayLabel}
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

            {/* Per-account lines */}
            {selectedAccountIds.map((id, i) => {
              const color = ACCOUNT_COLORS[i % ACCOUNT_COLORS.length];
              // Dashed style for future dates
              return (
                <Line
                  key={id}
                  type="monotone"
                  dataKey={id}
                  name={maskAccountName(accountMap[id] || 'Unknown')}
                  stroke={color}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: color }}
                />
              );
            })}

            {/* Total line (when multiple accounts) */}
            {selectedAccountIds.length > 1 && (
              <Line
                type="monotone"
                dataKey="total"
                name="Total"
                stroke="#78716c"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: '#78716c' }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
