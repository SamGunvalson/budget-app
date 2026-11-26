import { useEffect } from 'react';
import BudgetForm from '../components/budgets/BudgetForm';
import AnnualBudgetTable from '../components/budgets/AnnualBudgetTable';
import TopBar from '../components/common/TopBar';
import PageHeader from '../components/common/PageHeader';
import useSessionState from '../hooks/useSessionState';

export default function BudgetPage() {
  const [viewMode, setViewMode] = useSessionState('budgetViewMode', 'monthly'); // 'monthly' | 'annual'

  useEffect(() => { document.title = 'Budget App | Budgets'; }, []);

  return (
    <div className="min-h-screen app-bg">
      <TopBar pageName="Budgets" />

      {/* Content */}
      <div className={`mx-auto px-4 py-8 sm:px-6 ${viewMode === 'annual' ? 'max-w-full' : 'max-w-4xl'}`}>
        {/* Page header + view toggle */}
        <PageHeader eyebrow={viewMode === 'monthly' ? 'Monthly spending plan' : 'Annual plan'} title="Budgets">

          {/* Toggle */}
          <div className="flex items-center rounded-xl border border-stone-200 bg-white p-1 shadow-sm dark:border-stone-700 dark:bg-stone-800">
            <button
              type="button"
              onClick={() => setViewMode('monthly')}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-all ${
                viewMode === 'monthly'
                  ? 'bg-stone-900 text-stone-50 shadow-sm dark:bg-stone-100 dark:text-stone-900'
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
                  ? 'bg-stone-900 text-stone-50 shadow-sm dark:bg-stone-100 dark:text-stone-900'
                  : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              Annual
            </button>
          </div>
        </PageHeader>

        {viewMode === 'monthly' ? <BudgetForm /> : <AnnualBudgetTable />}
      </div>
    </div>
  );
}
