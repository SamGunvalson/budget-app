import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import { toDollars, formatCurrency, formatAxisDollarSigned } from '../../utils/helpers';

/**
 * Custom tooltip for the summary chart.
 */
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-xl border border-stone-200/60 bg-white px-4 py-3 shadow-lg shadow-stone-200/40 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <p className="mb-1.5 text-sm font-semibold text-stone-900 dark:text-stone-100">{label}</p>
      {payload.map((entry) => (
        <div key={entry.dataKey} className="flex items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: entry.fill }}
          />
          <span className="text-sm text-stone-600 dark:text-stone-300">
            {entry.name}:{' '}
            <span className="font-medium text-stone-900 dark:text-stone-100">
              {formatCurrency(Math.abs(entry.value) * 100)}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Summary bar chart comparing planned vs actual for
 * Total Income, Total Expenses, and NET.
 *
 * @param {{
 *   plannedIncome: number,
 *   actualIncome: number,
 *   plannedExpenses: number,
 *   actualExpenses: number,
 *   title?: string,
 * }} props
 *
 * All monetary values are in cents.
 */
export default function PlanVsActualChart({
  plannedIncome = 0,
  actualIncome = 0,
  plannedExpenses = 0,
  actualExpenses = 0,
  title = 'Plan vs Actual',
}) {
  const hasData = plannedIncome > 0 || actualIncome > 0 || plannedExpenses > 0 || actualExpenses > 0;

  if (!hasData) {
    return (
      <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <h3 className="mb-4 text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
        <p className="py-10 text-center text-sm text-stone-400 dark:text-stone-500">
          No data to display. Create a budget plan and log transactions to see
          comparisons.
        </p>
      </div>
    );
  }

  const plannedNet = plannedIncome - plannedExpenses;
  const actualNet = actualIncome - actualExpenses;

  const chartData = [
    {
      label: 'Total Income',
      Planned: toDollars(plannedIncome),
      Actual: toDollars(actualIncome),
      plannedColor: '#D1D5DB',
      actualColor: '#10B981',
    },
    {
      label: 'Total Expenses',
      Planned: toDollars(plannedExpenses),
      Actual: toDollars(actualExpenses),
      plannedColor: '#D1D5DB',
      actualColor: '#F59E0B',
    },
    {
      label: 'NET',
      Planned: toDollars(plannedNet),
      Actual: toDollars(actualNet),
      plannedColor: '#D1D5DB',
      actualColor: actualNet >= 0 ? '#10B981' : '#EF4444',
    },
  ];

  return (
    <div className="animate-fade-in rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
        <div className="flex items-center gap-4 text-xs text-stone-500 dark:text-stone-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-gray-300" />
            Planned
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-500" />
            Actual
          </span>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <BarChart
          data={chartData}
          layout="vertical"
          margin={{ left: 8, right: 24, top: 4, bottom: 4 }}
        >
          <XAxis
            type="number"
            tickFormatter={formatAxisDollarSigned}
            tick={{ fill: '#78716c', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={120}
            tick={{ fill: '#44403c', fontSize: 13, fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(245, 158, 11, 0.06)' }} />
          <ReferenceLine x={0} stroke="#e7e5e4" />
          <Bar dataKey="Planned" radius={[0, 6, 6, 0]} barSize={14} name="Planned">
            {chartData.map((entry, i) => (
              <Cell key={`planned-${i}`} fill={entry.plannedColor} />
            ))}
          </Bar>
          <Bar dataKey="Actual" radius={[0, 6, 6, 0]} barSize={14} name="Actual">
            {chartData.map((entry, i) => (
              <Cell key={`actual-${i}`} fill={entry.actualColor} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
