import { useState, useEffect, useRef } from 'react';
import { getMonthName, maskAccountName } from '../../utils/helpers';
import useAvailableYears from '../../hooks/useAvailableYears';
import useSessionState from '../../hooks/useSessionState';

const TYPE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Income', value: 'income' },
  { label: 'Expenses', value: 'expense' },
  { label: 'Transfers', value: 'transfer' },
];

const STATUS_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Posted', value: 'posted' },
  { label: 'Pending', value: 'pending' },
  { label: 'Projected', value: 'projected' },
];

/**
 * TransactionFilters — rich filter bar for the transactions table.
 *
 * Props:
 *  - categories: Array of category objects
 *  - filters: { searchText, categoryId, type, amountExact, dateStart, dateEnd }
 *  - onFiltersChange(filters): update filter state
 *  - viewMode: 'monthly' | 'yearly'
 *  - month, year: current period selection
 *  - onMonthChange(month), onYearChange(year): period selectors
 *  - onViewModeChange(mode): toggle monthly/yearly
 *  - resultCount: number of filtered results to display
 */
export default function TransactionFilters({
  categories,
  accounts,
  filters,
  onFiltersChange,
  viewMode,
  month,
  year,
  onMonthChange,
  onYearChange,
  onViewModeChange,
  resultCount,
}) {
  const [localSearch, setLocalSearch] = useState(filters.searchText || '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filtersOpen, setFiltersOpen] = useSessionState('txFiltersOpen', false);
  const debounceRef = useRef(null);

  // Debounce text search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onFiltersChange({ ...filters, searchText: localSearch });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [localSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const { years } = useAvailableYears();

  const hasActiveFilters = filters.searchText || filters.categoryId || filters.accountId || filters.type !== 'all' || filters.statusFilter !== 'all' || filters.amountExact || filters.dateStart || filters.dateEnd;

  const clearAll = () => {
    setLocalSearch('');
    onFiltersChange({ searchText: '', categoryId: '', accountId: '', type: 'all', statusFilter: 'all', amountExact: '', dateStart: '', dateEnd: '' });
  };

  return (
    <div className="space-y-4">
      {/* Row 1: View mode tabs + period selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Monthly / Yearly toggle */}
        <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50/50 p-1 dark:border-stone-700 dark:bg-stone-700/50">
          <button
            type="button"
            onClick={() => onViewModeChange('monthly')}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
              viewMode === 'monthly'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100'
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('yearly')}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
              viewMode === 'yearly'
                ? 'bg-amber-500 text-white shadow-sm'
                : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100'
            }`}
          >
            Yearly
          </button>
        </div>

        {/* Period selectors + Filters toggle */}
        <div className="flex items-center gap-2">
          {viewMode === 'monthly' && (
            <select
              value={month}
              onChange={(e) => onMonthChange(Number(e.target.value))}
              className="rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2 text-sm font-medium text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{getMonthName(m)}</option>
              ))}
            </select>
          )}
          <select
            value={year}
            onChange={(e) => onYearChange(Number(e.target.value))}
            className="rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2 text-sm font-medium text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
          >
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          {/* Filters toggle */}
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={`relative flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
              filtersOpen
                ? 'border-amber-300 bg-amber-500 text-white shadow-md shadow-amber-200/50'
                : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:shadow-md dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" />
            </svg>
            Filters
            <svg className={`h-3 w-3 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
            {!filtersOpen && hasActiveFilters && (
              <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white dark:ring-stone-800" />
            )}
          </button>
        </div>
      </div>

      {/* Rows 2-4: Collapsible filter panel */}
      {filtersOpen && <div className="animate-fade-in space-y-4">
      {/* Row 2: Search + quick filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Text search */}
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            placeholder="Search description or payee…"
            className="w-full rounded-xl border border-stone-300 bg-stone-50/50 py-2 pl-9 pr-4 text-sm text-stone-900 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700 placeholder:text-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          {localSearch && (
            <button
              type="button"
              onClick={() => setLocalSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Category dropdown */}
        <select
          value={filters.categoryId || ''}
          onChange={(e) => onFiltersChange({ ...filters, categoryId: e.target.value })}
          className="rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2 text-sm text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
        >
          <option value="">All Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>{cat.name} ({cat.type})</option>
          ))}
        </select>

        {/* Account dropdown */}
        <select
          value={filters.accountId || ''}
          onChange={(e) => onFiltersChange({ ...filters, accountId: e.target.value })}
          className="rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2 text-sm text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
        >
          <option value="">All Accounts</option>
          {(accounts || []).map((a) => (
            <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
          ))}
        </select>

        {/* Type pills */}
        <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50/50 p-0.5 dark:border-stone-700 dark:bg-stone-700/50">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onFiltersChange({ ...filters, type: opt.value })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                filters.type === opt.value
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Status pills */}
        <div className="inline-flex rounded-xl border border-stone-200 bg-stone-50/50 p-0.5 dark:border-stone-700 dark:bg-stone-700/50">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => onFiltersChange({ ...filters, statusFilter: opt.value })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                (filters.statusFilter || 'all') === opt.value
                  ? 'bg-violet-500 text-white shadow-sm'
                  : 'text-stone-600 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Advanced toggle */}
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-500 shadow-sm transition-all hover:bg-stone-50 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-300"
        >
          {showAdvanced ? 'Less' : 'More'}
          <svg className={`ml-1 inline h-3 w-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </button>
      </div>

      {/* Row 3: Advanced filters (collapsible) */}
      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stone-200/60 bg-stone-50/30 p-3 dark:border-stone-700/60 dark:bg-stone-700/20">
          {/* Exact amount search */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-stone-400 dark:text-stone-500">$</span>
              <input
                type="number"
                step="0.01"
                value={filters.amountExact || ''}
                onChange={(e) => onFiltersChange({ ...filters, amountExact: e.target.value })}
                placeholder="Exact amount"
                className="w-32 rounded-xl border border-stone-300 bg-white py-2 pl-7 pr-3 text-sm text-stone-900 placeholder:text-stone-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
              />
            </div>
          </div>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-stone-500 dark:text-stone-400">Date range</label>
            <input
              type="date"
              value={filters.dateStart || ''}
              onChange={(e) => onFiltersChange({ ...filters, dateStart: e.target.value })}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
            />
            <span className="text-xs text-stone-400 dark:text-stone-500">to</span>
            <input
              type="date"
              value={filters.dateEnd || ''}
              onChange={(e) => onFiltersChange({ ...filters, dateEnd: e.target.value })}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
            />
          </div>
        </div>
      )}

      {/* Active filter count + clear */}
      {hasActiveFilters && (
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
            {resultCount} result{resultCount !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs font-medium text-amber-600 transition-colors hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
          >
            Clear all filters
          </button>
        </div>
      )}
      </div>}
    </div>
  );
}
