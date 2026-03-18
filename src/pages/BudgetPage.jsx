import { useEffect } from 'react';
import BudgetForm from '../components/budgets/BudgetForm';
import AnnualBudgetTable from '../components/budgets/AnnualBudgetTable';
import TopBar from '../components/common/TopBar';
import useSessionState from '../hooks/useSessionState';

export default function BudgetPage() {
  const [viewMode, setViewMode] = useSessionState('budgetViewMode', 'monthly'); // 'monthly' | 'annual'

  useEffect(() => { document.title = 'Budget App | Budgets'; }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <TopBar pageName="Budgets" />

      {/* Content */}
      <div className={`mx-auto px-4 py-8 sm:px-6 ${viewMode === 'annual' ? 'max-w-full' : 'max-w-4xl'}`}>
        {/* Page header + view toggle */}
        <div className="animate-fade-in mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">Budget Planner</h1>
            <p className="mt-2 text-base text-stone-500 dark:text-stone-400">
              {viewMode === 'monthly'
                ? 'Set your monthly income and allocate amounts to each category.'
                : 'View and edit all 12 months at a glance.'}
            </p>
          </div>

          {/* Toggle */}
          <div className="flex items-center rounded-xl border border-stone-200 bg-white p-1 shadow-sm dark:border-stone-700 dark:bg-stone-800">
            <button
              type="button"
              onClick={() => setViewMode('monthly')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                viewMode === 'monthly'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-200/50'
                  : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setViewMode('annual')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                viewMode === 'annual'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-200/50'
                  : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              Annual
            </button>
          </div>
        </div>

        {viewMode === 'monthly' ? <BudgetForm /> : <AnnualBudgetTable />}
      </div>
    </div>
  );
}
