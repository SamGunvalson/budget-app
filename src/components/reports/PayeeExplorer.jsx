import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import CategoryDrillDown from './CategoryDrillDown';
import DataUnavailable from '../common/DataUnavailable';
import EmptyState from '../common/EmptyState';
import SegmentedControl from '../common/SegmentedControl';
import { useUserPreference } from '../../hooks/queries';
import useReportData from '../../hooks/useReportData';
import useSessionState from '../../hooks/useSessionState';
import { setUserPreferenceOffline } from '../../services/offlineAware';
import { CATEGORY_FALLBACK_COLOR } from '../../constants/chartColors';
import { formatCurrency, getMonthName } from '../../utils/helpers';
import {
  IGNORED_PAYEES_PREF,
  PAYEE_WINDOW_MONTHS,
  ignoredPayeesFrom,
  payeeGroups,
  payeeTransactions,
  payeeWindowKeys,
  toggleIgnoredPayee,
  txMonthKey,
} from '../../utils/reportAggregations';

const money = (cents) => formatCurrency(cents, 'USD', { hideCents: true });
const PAGE_SIZE = 50;

/**
 * Reports › Categories › Payees: payees over the last 12 months with their
 * category split. "Mixed" payees (3+ transactions in more than one category)
 * are the likeliest miscategorizations; expanding one shows its transactions
 * with bulk recategorize. Payees that really are mixed (Amazon, Target) can be
 * ignored; the list lives in the `payee_consistency_ignored` preference.
 *
 * Deep link: `?payee=<normalized key>` opens that payee.
 *
 * @param {{ month: number, year: number, asOf: string | null }} props
 */
export default function PayeeExplorer({ month, year, asOf }) {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const focusPayee = searchParams.get('payee');
  const [filter, setFilter] = useSessionState('reportsPayeeFilter', 'mixed'); // 'mixed' | 'all' | 'ignored'
  const [search, setSearch] = useState('');
  const [expandedKey, setExpandedKey] = useState(focusPayee);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [saveError, setSaveError] = useState('');

  const windowKeys = useMemo(() => payeeWindowKeys(year, month), [year, month]);
  const { settled, categories, setYearTransactions, isLoading, failed } = useReportData({
    year,
    keyLists: [windowKeys],
    asOf,
  });
  const prefQuery = useUserPreference(IGNORED_PAYEES_PREF);
  const ignored = useMemo(() => ignoredPayeesFrom(prefQuery.data), [prefQuery.data]);

  const windowTransactions = useMemo(() => {
    const keys = new Set(windowKeys);
    return settled.filter((t) => keys.has(txMonthKey(t)));
  }, [settled, windowKeys]);
  const groups = useMemo(() => payeeGroups(windowTransactions, { ignore: ignored }), [windowTransactions, ignored]);

  const counts = useMemo(() => ({
    mixed: groups.filter((g) => g.mixed).length,
    all: groups.length,
    ignored: groups.filter((g) => g.ignored).length,
  }), [groups]);

  // A deep-linked payee that isn't mixed still has to be visible.
  const activeFilter = focusPayee && filter === 'mixed' && !groups.find((g) => g.key === focusPayee)?.mixed
    ? 'all'
    : filter;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return groups.filter((g) => {
      // Keep the open payee in place while it is being fixed, even once it no
      // longer matches the filter.
      if (g.key === expandedKey) return true;
      if (activeFilter === 'mixed' && !g.mixed) return false;
      if (activeFilter === 'ignored' && !g.ignored) return false;
      return !term || g.key.includes(term) || g.label.toLowerCase().includes(term);
    });
  }, [groups, activeFilter, search, expandedKey]);

  useEffect(() => {
    if (isLoading || !focusPayee) return;
    document.getElementById(`payee-row-${focusPayee}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [isLoading, focusPayee]);

  const handleToggleIgnore = async (key) => {
    const next = { payees: toggleIgnoredPayee(ignored, key) };
    const queryKey = ['user_preferences', IGNORED_PAYEES_PREF];
    const previous = queryClient.getQueryData(queryKey);
    queryClient.setQueryData(queryKey, next);
    setSaveError('');
    try {
      await setUserPreferenceOffline(IGNORED_PAYEES_PREF, next);
    } catch (err) {
      queryClient.setQueryData(queryKey, previous);
      setSaveError(err?.message || 'Could not save the ignore list.');
    }
  };

  const windowLabel = `${PAYEE_WINDOW_MONTHS} months to ${getMonthName(month)} ${year}`;

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-2xl border border-stone-200/60 bg-white dark:border-stone-700/60 dark:bg-stone-800" />
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <DataUnavailable
        eyebrow={windowLabel}
        title="Payees unavailable"
        message="Couldn't load transactions for this period, so no payees are shown."
        onRetry={() => failed.refetch()}
        retrying={failed.isFetching}
      />
    );
  }

  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          ariaLabel="Payee filter"
          size="sm"
          value={activeFilter}
          onChange={(value) => { setFilter(value); setLimit(PAGE_SIZE); }}
          options={[
            { value: 'mixed', label: `Mixed (${counts.mixed})` },
            { value: 'all', label: `All (${counts.all})` },
            { value: 'ignored', label: `Ignored (${counts.ignored})` },
          ]}
        />
        <input
          type="search"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setLimit(PAGE_SIZE); }}
          placeholder="Search payees"
          aria-label="Search payees"
          className="w-full min-w-0 rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2 text-sm text-stone-900 placeholder-stone-400 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 sm:w-auto sm:max-w-xs sm:flex-1 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
        />
      </div>
      <p className="px-1 text-xs text-stone-500 dark:text-stone-400">
        {windowLabel}. A payee is mixed when 3 or more of its transactions are spread over more than one category.
      </p>

      {saveError && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {saveError}
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title={activeFilter === 'mixed' && !search ? 'Every payee is consistent' : 'No matching payees'}
          hint={activeFilter === 'mixed' && !search
            ? `No payee was split across categories in the ${windowLabel.toLowerCase()}.`
            : 'Try another filter or search.'}
        />
      ) : (
        <div className="divide-y divide-stone-200/60 overflow-clip rounded-2xl border border-stone-200/60 bg-white shadow-sm dark:divide-stone-700/60 dark:border-stone-700/60 dark:bg-stone-800">
          {visible.slice(0, limit).map((group) => {
            const expanded = expandedKey === group.key;
            return (
              <div key={group.key} id={`payee-row-${group.key}`} className="scroll-mt-24">
                <div className={`flex items-start gap-2 px-4 py-3 ${expanded ? 'bg-stone-50 dark:bg-stone-700/40' : ''}`}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedKey(expanded ? null : group.key)}
                    className="min-w-0 flex-1 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">{group.label}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-stone-900 dark:text-stone-100">{money(group.total)}</span>
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-500 dark:text-stone-400">
                      {group.count} {group.count === 1 ? 'transaction' : 'transactions'}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {group.categories.map((cat, i) => {
                        // The most-used category first; the rest are the likely mistakes.
                        const outlier = group.mixed && i > 0;
                        return (
                          <span
                            key={cat.categoryId}
                            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ${
                              outlier
                                ? 'bg-warn-bg text-warn'
                                : 'bg-stone-100 text-stone-700 dark:bg-stone-700 dark:text-stone-200'
                            }`}
                          >
                            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: cat.color || CATEGORY_FALLBACK_COLOR }} />
                            {cat.name} ×{cat.count}
                          </span>
                        );
                      })}
                    </span>
                  </button>
                  {/* Ignoring only matters for mixed (or already ignored) payees. */}
                  {(group.mixed || group.ignored) && <button
                    type="button"
                    onClick={() => handleToggleIgnore(group.key)}
                    className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                  >
                    {group.ignored ? 'Unignore' : 'Ignore'}
                  </button>}
                </div>
                {expanded && (
                  <div className="border-t border-stone-200/60 dark:border-stone-700/60">
                    <CategoryDrillDown
                      transactions={payeeTransactions(windowTransactions, group.key)}
                      categories={categories}
                      categoryName={group.label}
                      categoryColor={CATEGORY_FALLBACK_COLOR}
                      onClose={() => setExpandedKey(null)}
                      onDataChanged={() => {}}
                      setAllTransactions={setYearTransactions}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {visible.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE_SIZE)}
          className="w-full rounded-xl border border-stone-200/60 bg-white py-2.5 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Show {Math.min(PAGE_SIZE, visible.length - limit)} more
        </button>
      )}
    </div>
  );
}
