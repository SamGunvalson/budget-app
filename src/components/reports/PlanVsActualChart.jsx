import { formatCurrency, toDollars } from '../../utils/helpers';

/**
 * A single metric row with a diverging bar chart anchored at the shared zero line.
 * Bars extend right for positive values and left for negative values, making
 * surplus vs deficit immediately obvious at a glance.
 */
function MetricRow({ label, planned, actual, actualColor, zeroPct, totalRange }) {
  const safeRange = totalRange || 1;

  const planBarWidth = (Math.abs(planned) / safeRange) * 100;
  const planBarLeft = planned >= 0 ? zeroPct : zeroPct - planBarWidth;

  const actBarWidth = (Math.abs(actual) / safeRange) * 100;
  const actBarLeft = actual >= 0 ? zeroPct : zeroPct - actBarWidth;

  const plannedCents = Math.round(Math.abs(planned) * 100);
  const actualCents = Math.round(Math.abs(actual) * 100);
  const planSign = planned < 0 ? '−' : '';
  const actSign = actual < 0 ? '−' : '';

  return (
    <div>
      {/* Label row */}
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-stone-700 dark:text-stone-300">{label}</span>
        <div className="flex shrink-0 items-baseline gap-3 text-xs">
          <span className="text-stone-400 dark:text-stone-500">
            Plan&nbsp;{planSign}{formatCurrency(plannedCents, 'USD', { hideCents: true })}
          </span>
          <span className="font-semibold" style={{ color: actualColor }}>
            Actual&nbsp;{actSign}{formatCurrency(actualCents, 'USD', { hideCents: true })}
          </span>
        </div>
      </div>
      {/* Diverging bars with a shared zero reference line */}
      <div className="relative space-y-1.5">
        {/* Zero reference line spanning both bar tracks */}
        <div
          className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-stone-400 dark:bg-stone-500"
          style={{ left: `${zeroPct}%`, transform: 'translateX(-50%)' }}
        />
        {/* Plan bar */}
        <div className="relative h-2.5 w-full rounded-full bg-stone-100 dark:bg-stone-700">
          <div
            className="absolute h-full rounded-full bg-stone-300 transition-all duration-500 dark:bg-stone-500"
            style={{
              left: `${Math.max(0, planBarLeft)}%`,
              width: `${Math.min(planBarWidth, 100 - Math.max(0, planBarLeft))}%`,
            }}
          />
        </div>
        {/* Actual bar */}
        <div className="relative h-2.5 w-full rounded-full bg-stone-100 dark:bg-stone-700">
          <div
            className="absolute h-full rounded-full transition-all duration-500"
            style={{
              left: `${Math.max(0, actBarLeft)}%`,
              width: `${Math.min(actBarWidth, 100 - Math.max(0, actBarLeft))}%`,
              backgroundColor: actualColor,
            }}
          />
        </div>
      </div>
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

  // Build a shared diverging scale so all rows are comparable and
  // the zero line is positioned proportionally (negative left, positive right).
  const allDollarValues = [
    toDollars(plannedIncome),
    toDollars(actualIncome),
    toDollars(plannedExpenses),
    toDollars(actualExpenses),
    toDollars(plannedNet),
    toDollars(actualNet),
  ];
  const globalMax = Math.max(...allDollarValues, 0);
  const globalMin = Math.min(...allDollarValues, 0);
  const totalRange = globalMax - globalMin || 1;
  // % position of the zero line from the left edge
  const zeroPct = (Math.abs(globalMin) / totalRange) * 100;

  const metrics = [
    {
      label: 'Income',
      planned: toDollars(plannedIncome),
      actual: toDollars(actualIncome),
      actualColor: '#10B981',
    },
    {
      label: 'Expenses',
      planned: toDollars(plannedExpenses),
      actual: toDollars(actualExpenses),
      actualColor: '#F59E0B',
    },
    {
      label: 'Net',
      planned: toDollars(plannedNet),
      actual: toDollars(actualNet),
      actualColor: actualNet >= 0 ? '#10B981' : '#EF4444',
    },
  ];

  return (
    <div className="animate-fade-in rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">{title}</h3>
        <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-stone-400">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-full bg-stone-300 dark:bg-stone-500" />
            Plan
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-full bg-emerald-500" />
            Actual
          </span>
        </div>
      </div>

      <div className="space-y-5">
        {metrics.map((m) => (
          <MetricRow key={m.label} {...m} zeroPct={zeroPct} totalRange={totalRange} />
        ))}
      </div>
    </div>
  );
}
