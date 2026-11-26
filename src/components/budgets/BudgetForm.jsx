import { useState } from 'react';
import BudgetItemInput from './BudgetItemInput';
import MonthYearSelector from '../common/MonthYearSelector';
import {
  useAnnualBudgetData,
  useBudgetItems,
  useBudgetPlan,
  useCategories,
} from '../../hooks/queries';
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

const TYPE_HEADER_STYLES = {
  income: {
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    text: 'text-emerald-800 dark:text-emerald-300',
    border: 'border-emerald-200/60 dark:border-emerald-700/60',
  },
  needs: {
    bg: 'bg-red-50 dark:bg-red-900/30',
    text: 'text-red-800 dark:text-red-300',
    border: 'border-red-200/60 dark:border-red-700/60',
  },
  wants: {
    bg: 'bg-pink-50 dark:bg-pink-900/30',
    text: 'text-pink-800 dark:text-pink-300',
    border: 'border-pink-200/60 dark:border-pink-700/60',
  },
  savings: {
    bg: 'bg-teal-50 dark:bg-teal-900/30',
    text: 'text-teal-800 dark:text-teal-300',
    border: 'border-teal-200/60 dark:border-teal-700/60',
  },
};

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

      {/* Category allocations by type – income first */}
      {['income', 'needs', 'wants', 'savings'].map((type) => {
        const cats = grouped[type];
        if (!cats || cats.length === 0) return null;
        const { label, desc } = typeLabels[type];
        const headerStyle = TYPE_HEADER_STYLES[type];

        return (
          <div key={type}>
            <div className={`mb-3 -mx-4 px-4 py-2.5 rounded-xl ${headerStyle.bg} border ${headerStyle.border}`}>
              <h3 className={`text-sm font-bold uppercase tracking-wider ${headerStyle.text}`}>{label}</h3>
              <p className="text-xs text-stone-500 mt-0.5 dark:text-stone-400">{desc}</p>
            </div>
            <div className="space-y-2">
              {cats.map((cat) => (
                <BudgetItemInput
                  key={cat.id}
                  category={cat}
                  plannedAmount={allocations[cat.id] || 0}
                  onChange={(cents) => handleAllocationChange(cat.id, cents)}
                  disabled={isSaving}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Summary bar */}
      <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Total Income</p>
            <p className="mt-1 text-xl font-bold text-stone-900 dark:text-stone-100">{formatCurrency(totalIncomeCents, 'USD', { hideCents: true })}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Total Allocated</p>
            <p className="mt-1 text-xl font-bold text-stone-900 dark:text-stone-100">{formatCurrency(totalAllocated, 'USD', { hideCents: true })}</p>
          </div>
        </div>
      </div>

      <div className="sticky bottom-[env(safe-area-inset-bottom,0px)] z-10 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-lg sm:bottom-3 dark:border-stone-700 dark:bg-stone-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-stone-600 dark:text-stone-300">Remaining to allocate</p>
            <p className={`text-xl font-bold tabular-nums ${remaining >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
              {formatCurrency(remaining)}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="shrink-0 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-stone-950 shadow-sm hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-amber-500 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : plan ? 'Save changes' : 'Create budget'}
          </button>
        </div>
        {error && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">{error}</p>}
        {success && <p role="status" className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">{success}</p>}
      </div>
    </div>
  );
}
