import { useEffect, useState } from 'react';
import BudgetItemInput from './BudgetItemInput';
import MonthYearSelector from '../common/MonthYearSelector';
import { getCategoriesOffline as getCategories } from '../../services/offlineAware';
import {
  getBudgetPlan,
  createBudgetPlan,
  updateBudgetPlan,
  getBudgetItems,
  upsertBudgetItems,
} from '../../services/budgets';
import {
  formatCurrency,
} from '../../utils/helpers';
import useMonthYear from '../../hooks/useMonthYear';

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

  const [categories, setCategories] = useState([]);
  const [plan, setPlan] = useState(null);           // budget_plans row (or null)
  const [allocations, setAllocations] = useState({}); // { [categoryId]: cents }

  const [isLoading, setIsLoading] = useState(true);
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

  // ---------- load data when month/year changes ----------
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError('');
      setSuccess('');
      try {
        // Fetch categories + existing plan in parallel
        const [cats, existingPlan] = await Promise.all([
          getCategories(),
          getBudgetPlan(month, year),
        ]);

        if (cancelled) return;
        setCategories(cats);

        if (existingPlan) {
          setPlan(existingPlan);

          const items = await getBudgetItems(existingPlan.id);
          if (cancelled) return;
          const alloc = {};
          items.forEach((item) => {
            alloc[item.category_id] = item.planned_amount;
          });
          setAllocations(alloc);
        } else {
          // new month – zeros
          setPlan(null);
          const alloc = {};
          cats.forEach((c) => {
            alloc[c.id] = 0;
          });
          setAllocations(alloc);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load budget data');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [month, year]);

  // ---------- handlers ----------
  const handleMonthYearChange = (m, y) => {
    setMonthYear(m, y);
  };

  const handleAllocationChange = (categoryId, cents) => {
    setAllocations((prev) => ({ ...prev, [categoryId]: cents }));
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setIsSaving(true);

    try {
      let currentPlan = plan;

      // 1. Create or update the budget plan
      if (!currentPlan) {
        currentPlan = await createBudgetPlan({
          month,
          year,
          total_income: totalIncomeCents,
        });
        setPlan(currentPlan);
      } else {
        currentPlan = await updateBudgetPlan(currentPlan.id, {
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
      await upsertBudgetItems(items);

      setSuccess('Budget saved successfully!');
    } catch (err) {
      setError(err.message || 'Failed to save budget');
    } finally {
      setIsSaving(false);
    }
  };

  // ---------- group categories by type (exclude transfer from budget) ----------
  const budgetableCategories = categories.filter((c) => c.type !== 'transfer');
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
  if (isLoading) {
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
      {error && (
        <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <span className="mr-1.5">⚠</span>{error}
        </div>
      )}
      {success && (
        <div className="animate-fade-in rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
          <span className="mr-1.5">✓</span>{success}
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Total Income</p>
            <p className="mt-1 text-xl font-bold text-stone-900 dark:text-stone-100">{formatCurrency(totalIncomeCents, 'USD', { hideCents: true })}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Total Allocated</p>
            <p className="mt-1 text-xl font-bold text-stone-900 dark:text-stone-100">{formatCurrency(totalAllocated, 'USD', { hideCents: true })}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">Remaining</p>
            <p className={`mt-1 text-xl font-bold ${remaining >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(remaining, 'USD', { hideCents: true })}
            </p>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-xl bg-amber-500 px-8 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : plan ? 'Update Budget' : 'Create Budget'}
        </button>
      </div>
    </div>
  );
}
