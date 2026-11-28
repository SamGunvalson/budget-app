import { useState } from 'react';
import BudgetItemInput from './BudgetItemInput';
import MonthYearSelector from '../common/MonthYearSelector';
import {
  useAnnualBudgetData,
  useBudgetItems,
  useBudgetPlan,
  useCategories,
  usePlanVsActual,
} from '../../hooks/queries';
import useThresholds from '../../hooks/useThresholds';
import { getCurrentMonthYear, getTodayString } from '../../utils/helpers';
import {
  createBudgetPlanOffline,
  updateBudgetPlanOffline,
  upsertBudgetItemsOffline,
} from '../../services/offlineAware';
import {
  formatCurrency,
} from '../../utils/helpers';
import useMonthYear from '../../hooks/useMonthYear';
import { categoriesForBudget } from '../../utils/categoryArchive';
import { buttonClasses } from '../../utils/buttonClasses';
import { monthSpendingSummary } from '../../utils/budgetCalculations';
import { hapticSuccess } from '../../utils/haptics';
import DataUnavailable from '../common/DataUnavailable';
import { isQueryUnavailable } from '../../utils/queryState';
import { TYPE_DOT_CLASSES } from '../../constants/typeStyles';

// Type colors live in one place: constants/typeStyles.js.
const TYPE_DOTS = TYPE_DOT_CLASSES;

/**
 * Full budget-planning form.
 * Lets users set total income and per-category planned amounts for a month.
 */
export default function BudgetForm() {
  const { month, year, setMonthYear } = useMonthYear();

  const { data: categories = [] } = useCategories();
  const annualBudgetQuery = useAnnualBudgetData(year);
  // Reads go through the offline-aware SWR hooks: cached data renders at once,
  // and a backend blip (e.g. a 502 from the proxy) falls back to the cache
  // instead of surfacing as a load error.
  const planQuery = useBudgetPlan(month, year);
  const serverPlan = planQuery.data ?? null;
  const itemsQuery = useBudgetItems(serverPlan?.id);
  const serverItems = serverPlan ? itemsQuery.data : null;
  const dataReady = planQuery.isSuccess && (!serverPlan || itemsQuery.isSuccess);
  const isFetching = planQuery.isFetching || itemsQuery.isFetching;

  const [plan, setPlan] = useState(null);           // budget_plans row (or null)
  const [allocations, setAllocations] = useState({}); // { [categoryId]: cents }
  const [savedAllocations, setSavedAllocations] = useState({});
  // Which month and which query results the form state was last seeded from.
  const [seeded, setSeeded] = useState({ key: null, plan: null, items: null });

  // This month's actual spending/income per category (for progress bars).
  // Same cutoff as Reports' default: only activity settled by today counts, so a
  // scheduled (future-dated) paycheck or bill never shows as received/spent.
  const pvaQuery = usePlanVsActual(month, year, { asOf: getTodayString() });
  const actuals = pvaQuery.data ?? null;
  const hasActuals = actuals != null;
  const actualsFailed = isQueryUnavailable(pvaQuery);
  const actualByCategory = new Map((actuals?.categories ?? []).map((c) => [c.categoryId, c.actual]));
  const { thresholds } = useThresholds();

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // ---------- derived ----------
  // Income = sum of income-category allocations
  const incomeCategoryIds = new Set(categories.filter((c) => c.type === 'income').map((c) => c.id));
  const transferCategoryIds = new Set(categories.filter((c) => c.type === 'transfer').map((c) => c.id));
  const totalIncomeCents = Object.entries(allocations)
    .filter(([id]) => incomeCategoryIds.has(id))
    .reduce((sum, [, cents]) => sum + (cents || 0), 0);
  // Allocated = sum of non-income, non-transfer category allocations
  const totalAllocated = Object.entries(allocations)
    .filter(([id]) => !incomeCategoryIds.has(id) && !transferCategoryIds.has(id))
    .reduce((sum, [, cents]) => sum + (cents || 0), 0);
  const remaining = totalIncomeCents - totalAllocated;
  const now = getCurrentMonthYear();
  const isCurrentMonth = now.month === month && now.year === year;
  const isDirty = Object.keys({ ...allocations, ...savedAllocations })
    .some((id) => (allocations[id] || 0) !== (savedAllocations[id] || 0));

  // ---------- seed form state from the queries ----------
  // Render-time pattern (avoids set-state-in-effect lint rule). Seed when the
  // month changes, and again when a background revalidation brings new data —
  // but never over unsaved edits or mid-save.
  const periodKey = `${year}-${month}`;
  const periodChanged = seeded.key !== periodKey;
  const dataChanged = seeded.plan !== serverPlan || seeded.items !== serverItems;
  if (
    dataReady &&
    (periodChanged || (dataChanged && !isDirty && !isSaving && !isFetching))
  ) {
    setSeeded({ key: periodKey, plan: serverPlan, items: serverItems });
    setPlan(serverPlan);
    if (serverPlan) {
      const alloc = {};
      (serverItems ?? []).forEach((item) => {
        alloc[item.category_id] = item.planned_amount;
      });
      setAllocations(alloc);
      setSavedAllocations(alloc);
    } else {
      // new month – zeros
      const alloc = {};
      categories.filter((c) => !c.is_archived).forEach((c) => {
        alloc[c.id] = 0;
      });
      setAllocations(alloc);
      setSavedAllocations({});
    }
    if (periodChanged) {
      setError('');
      setSuccess('');
    }
  }
  const loadError = planQuery.error || itemsQuery.error || annualBudgetQuery.error;
  const isLoading = periodChanged && !loadError;

  // ---------- handlers ----------
  const handleMonthYearChange = (m, y) => {
    setMonthYear(m, y);
  };

  const handleAllocationChange = (categoryId, cents) => {
    setSuccess('');
    setAllocations((prev) => ({ ...prev, [categoryId]: cents }));
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setIsSaving(true);

    try {
      let currentPlan = plan;

      // 1. Create or update the budget plan. The offline wrappers keep the
      // local cache in step and notify the budget_plans / budget_items queries.
      if (!currentPlan) {
        currentPlan = await createBudgetPlanOffline({
          month,
          year,
          total_income: totalIncomeCents,
        });
        setPlan(currentPlan);
      } else {
        currentPlan = await updateBudgetPlanOffline(currentPlan.id, {
          total_income: totalIncomeCents,
        });
        setPlan(currentPlan);
      }

      // 2. Bulk-upsert all allocations
      const items = Object.entries(allocations).map(([category_id, planned_amount]) => ({
        budget_plan_id: currentPlan.id,
        category_id,
        planned_amount: planned_amount || 0,
      }));
      await upsertBudgetItemsOffline(items);

      setSavedAllocations(allocations);
      setSuccess('Budget saved successfully!');
      hapticSuccess();
    } catch (err) {
      setError(err.message || 'Failed to save budget');
    } finally {
      setIsSaving(false);
    }
  };

  // ---------- group categories by type (exclude transfer from budget) ----------
  const budgetableCategories = categoriesForBudget(categories, {
    ...annualBudgetQuery.data,
    [month]: { allocations: savedAllocations },
  });
  // Headline totals use every signed expense row in the actuals (uncategorized
  // spending, categories outside the saved plan, net refunds), matching Reports.
  // `outsidePlan` is the part no row below accounts for, called out in the card.
  const {
    spent: spentThisMonth,
    received: receivedThisMonth,
    left: leftInPlan,
    usedPct,
    outsidePlan: outsidePlanSpend,
  } = monthSpendingSummary(actuals, {
    plannedSpending: totalAllocated,
    listedCategoryIds: new Set(budgetableCategories.map((c) => c.id)),
  });
  const barPct = Math.min(Math.max(usedPct, 0), 100);
  const grouped = { needs: [], wants: [], savings: [], income: [] };
  budgetableCategories.forEach((c) => {
    if (grouped[c.type]) grouped[c.type].push(c);
    else grouped[c.type] = [c]; // safety
  });

  const typeLabels = {
    needs: { label: 'Needs', desc: 'Essential expenses' },
    wants: { label: 'Wants', desc: 'Discretionary spending' },
    savings: { label: 'Savings', desc: 'Goals & investments' },
    income: { label: 'Income', desc: 'Revenue sources' },
  };
  const money = (cents) => formatCurrency(cents, 'USD', { hideCents: true });
  const showSaveBar = isDirty || isSaving || !!error || !plan;

  // ---------- render ----------
  if (isLoading || annualBudgetQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header row: month selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <MonthYearSelector month={month} year={year} onChange={handleMonthYearChange} />
      </div>

      {/* Alerts */}
      {loadError && (
        <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <span className="mr-1.5">⚠</span>{loadError.message}
        </div>
      )}

      {/* Month summary — waits for actuals; never shows $0 spent in place of missing data */}
      {plan && totalAllocated > 0 && !hasActuals && (
        actualsFailed ? (
          <DataUnavailable
            eyebrow="Spending this month"
            title="Spending data unavailable"
            message="Couldn't load this month's transactions, so progress isn't shown. Your plan below is still editable."
            onRetry={() => pvaQuery.refetch()}
            retrying={pvaQuery.isFetching}
          />
        ) : (
          <div aria-label="Loading month summary" aria-busy="true" className="h-44 animate-pulse rounded-2xl bg-forest/85" />
        )
      )}
      {plan && totalAllocated > 0 && hasActuals && (
        <section
          aria-label="Month summary"
          className="flex flex-col justify-between gap-6 rounded-2xl bg-forest p-6 text-[#fbfcf2] shadow-lg shadow-stone-900/10 sm:p-7"
        >
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d8e9d8]">
              {leftInPlan >= 0 ? 'Left in your spending plan' : 'Over your spending plan'}
            </p>
            <p className="mt-1.5 font-display text-5xl font-normal leading-none tracking-tight sm:text-6xl">
              {money(Math.abs(leftInPlan))}
            </p>
            <p className="mt-2 text-sm text-[#daeadc]">
              {spentThisMonth < 0 ? `${money(-spentThisMonth)} net refunds` : `${money(spentThisMonth)} spent`} of {money(totalAllocated)} budgeted
            </p>
            {outsidePlanSpend !== 0 && (
              <p className="mt-1 text-xs text-[#d8e9d8]">
                Includes {money(outsidePlanSpend)} in categories outside this plan
              </p>
            )}
          </div>
          <div>
            <div
              aria-hidden="true"
              className="h-4"
              style={{
                background: `linear-gradient(to right, ${leftInPlan >= 0 ? '#b8d9ac' : '#f5b887'} 0 ${barPct}%, #477365 ${barPct}% 100%)`,
                maskImage: 'repeating-linear-gradient(90deg, #000 0 calc(2.5% - 2px), transparent calc(2.5% - 2px) 2.5%)',
                WebkitMaskImage: 'repeating-linear-gradient(90deg, #000 0 calc(2.5% - 2px), transparent calc(2.5% - 2px) 2.5%)',
              }}
            />
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-[#ecf4e9]">
              <span>{usedPct}% used{isCurrentMonth ? ' so far' : ''}</span>
              <span>{money(receivedThisMonth)} of {money(totalIncomeCents)} income received</span>
            </div>
          </div>
        </section>
      )}

      {/* Category allocations by type – income first */}
      {['income', 'needs', 'wants', 'savings'].map((type) => {
        const cats = grouped[type];
        if (!cats || cats.length === 0) return null;
        const { label, desc } = typeLabels[type];
        const groupPlanned = cats.reduce((sum, c) => sum + (allocations[c.id] || 0), 0);
        const groupActual = cats.reduce((sum, c) => sum + (actualByCategory.get(c.id) ?? 0), 0);

        return (
          <section key={type} aria-labelledby={`budget-group-${type}`}>
            <div className="mb-2 flex items-end justify-between gap-3 px-1">
              <div>
                <h3 id={`budget-group-${type}`} className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600 dark:text-stone-300">
                  <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TYPE_DOTS[type]}`} />
                  {label}
                </h3>
                <p className="mt-0.5 text-xs text-stone-500 dark:text-stone-400">{desc}</p>
              </div>
              <p className="text-xs text-stone-500 dark:text-stone-400">
                {hasActuals && <>{money(groupActual)} {type === 'income' ? 'received' : 'spent'} of </>}
                <span className="font-semibold text-stone-700 dark:text-stone-200">{money(groupPlanned)}</span>
              </p>
            </div>
            <div className="divide-y divide-stone-200/60 overflow-hidden rounded-2xl border border-stone-200/60 bg-white shadow-sm dark:divide-stone-700/60 dark:border-stone-700/60 dark:bg-stone-800">
              {cats.map((cat) => (
                <BudgetItemInput
                  key={cat.id}
                  category={cat}
                  plannedAmount={allocations[cat.id] || 0}
                  actual={hasActuals ? (actualByCategory.get(cat.id) ?? 0) : null}
                  thresholds={thresholds}
                  onChange={(cents) => handleAllocationChange(cat.id, cents)}
                  disabled={isSaving}
                />
              ))}
            </div>
          </section>
        );
      })}

      {/* Plan totals */}
      <div className="grid grid-cols-3 gap-4 rounded-2xl border border-stone-200/60 bg-white p-5 shadow-sm dark:border-stone-700/60 dark:bg-stone-800">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500 dark:text-stone-400">Planned income</p>
          <p className="mt-1 text-lg font-bold text-stone-900 sm:text-xl dark:text-stone-100">{money(totalIncomeCents)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500 dark:text-stone-400">Allocated</p>
          <p className="mt-1 text-lg font-bold text-stone-900 sm:text-xl dark:text-stone-100">{money(totalAllocated)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500 dark:text-stone-400">To allocate</p>
          <p className={`mt-1 text-lg font-bold sm:text-xl ${remaining >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
            {formatCurrency(remaining, 'USD', { hideCents: true })}
          </p>
        </div>
        {success && !showSaveBar && (
          <p role="status" className="col-span-3 text-sm text-emerald-700 dark:text-emerald-400">{success}</p>
        )}
      </div>

      {/* Unsaved-changes bar: floats above the mobile tab bar / page bottom */}
      {showSaveBar && (
        <div
          className="sticky z-10 rounded-2xl border border-stone-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur-md dark:border-stone-700 dark:bg-stone-800/95"
          style={{ bottom: 'calc(var(--bottom-chrome, 0px) + 12px)' }}
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-stone-600 dark:text-stone-300">
                {plan ? 'Unsaved changes' : 'New budget'}
              </p>
              <p className={`text-lg font-bold tabular-nums ${remaining >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
                {formatCurrency(remaining)}
                <span className="ml-1 text-xs font-medium text-stone-500 dark:text-stone-400">to allocate</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className={buttonClasses({ variant: 'primary', className: 'shrink-0' })}
            >
              {isSaving ? 'Saving…' : plan ? 'Save changes' : 'Create budget'}
            </button>
          </div>
          {error && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>}
          {success && <p role="status" className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">{success}</p>}
        </div>
      )}
    </div>
  );
}
