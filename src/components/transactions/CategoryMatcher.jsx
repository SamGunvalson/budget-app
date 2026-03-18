import { useState, useMemo } from 'react';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { autoMatchCategory, detectTransferPairs } from '../../services/import';
import { normalizeDate, normalizeAmount } from '../../utils/csvParser';

/**
 * CategoryMatcher — shows each transaction row with auto-matched category
 * and allows manual override before final import.
 *
 * Props:
 *  - mappedRows: object[] — { date, amount, description } raw values
 *  - categories: object[] — user's categories from DB
 *  - onConfirm(assignments, excludedRows, transferPairs): called when user confirms
 *  - onBack(): go to previous step
 */
export default function CategoryMatcher({ mappedRows, categories, onConfirm, onBack }) {
  // manualOverrides: user-selected categories that override auto-match
  const [manualOverrides, setManualOverrides] = useState({});
  const [excludedRows, setExcludedRows] = useState(new Set());
  const [filter, setFilter] = useState('all'); // 'all' | 'matched' | 'unmatched' | 'excluded'

  // Auto-match categories from CSV category name or description keywords
  const autoAssignments = useMemo(() => {
    const auto = {};
    mappedRows.forEach((row, idx) => {
      // Try CSV category name match first (exact, case-insensitive)
      const csvCat = String(row.csvCategory || '').trim();
      let catId = null;
      if (csvCat) {
        const matched = categories.find(
          (c) => c.name.toLowerCase() === csvCat.toLowerCase()
        );
        if (matched) catId = matched.id;
      }
      // Fall back to description/payee/csvCategory keyword auto-match
      if (!catId) {
        const desc = String(row.description || '');
        catId = autoMatchCategory(desc, categories, {
          payee: String(row.payee || ''),
          csvCategory: csvCat,
        });
      }
      if (catId) auto[idx] = catId;
    });
    return auto;
  }, [mappedRows, categories]);

  // Merge auto-assignments with manual overrides (manual wins)
  const assignments = useMemo(() => {
    return { ...autoAssignments, ...manualOverrides };
  }, [autoAssignments, manualOverrides]);

  // Detect transfer pairs after assignments are resolved
  const [manualUnpairs, setManualUnpairs] = useState(new Set());

  const transferPairs = useMemo(() => {
    // Build pseudo-validated rows with resolved category_id for pair detection
    const pseudoRows = mappedRows.map((row, idx) => {
      const { date } = normalizeDate(row.date);
      let cents, isExpense;
      if (row._amountPreResolved) {
        cents = row.amount;
        isExpense = row.isExpense;
      } else {
        const norm = normalizeAmount(row.amount);
        cents = norm.cents;
        isExpense = norm.isNegative;
      }
      return {
        _rowIndex: idx,
        transaction_date: date,
        amount: isExpense ? -Math.abs(cents) : Math.abs(cents),
        description: row.description || '',
        payee: row.payee || '',
        category_id: assignments[idx] || null,
      };
    });
    const pairs = detectTransferPairs(pseudoRows, categories);
    // Remove manually unpaired entries
    for (const idx of manualUnpairs) {
      const pairedIdx = pairs.get(idx);
      if (pairedIdx !== undefined) {
        pairs.delete(idx);
        pairs.delete(pairedIdx);
      }
    }
    return pairs;
  }, [mappedRows, assignments, categories, manualUnpairs]);

  // Transform rows for display
  const displayRows = useMemo(() => {
    return mappedRows.map((row, idx) => {
      const { date } = normalizeDate(row.date);

      // If amount was pre-resolved by ColumnMapper (split mode), use directly
      let cents, isExpense;
      if (row._amountPreResolved) {
        cents = row.amount;
        isExpense = row.isExpense;
      } else {
        const norm = normalizeAmount(row.amount);
        cents = norm.cents;
        isExpense = norm.isNegative;
      }

      return {
        idx,
        date,
        amount: cents,
        isExpense,
        description: row.description || '',
        payee: row.payee || '',
        categoryId: assignments[idx] || null,
      };
    });
  }, [mappedRows, assignments]);

  // Active (non-excluded) rows
  const activeRows = useMemo(() => displayRows.filter((r) => !excludedRows.has(r.idx)), [displayRows, excludedRows]);
  const excludedCount = excludedRows.size;
  const matchedCount = activeRows.filter((r) => r.categoryId).length;
  const unmatchedCount = activeRows.length - matchedCount;
  const pairedCount = new Set([...transferPairs.keys()].filter((k) => !excludedRows.has(k))).size / 2;

  const filteredRows = useMemo(() => {
    if (filter === 'excluded') return displayRows.filter((r) => excludedRows.has(r.idx));
    if (filter === 'matched') return activeRows.filter((r) => r.categoryId);
    if (filter === 'unmatched') return activeRows.filter((r) => !r.categoryId);
    return activeRows;
  }, [displayRows, activeRows, excludedRows, filter]);

  function handleCategoryChange(rowIdx, categoryId) {
    setManualOverrides((prev) => ({
      ...prev,
      [rowIdx]: categoryId || undefined,
    }));
  }

  function handleBulkAssign(categoryId) {
    // Assign to all unmatched active rows
    const updated = { ...manualOverrides };
    activeRows.forEach((row) => {
      if (!row.categoryId) {
        updated[row.idx] = categoryId;
      }
    });
    setManualOverrides(updated);
  }

  function handleExcludeRow(rowIdx) {
    setExcludedRows((prev) => {
      const next = new Set(prev);
      next.add(rowIdx);
      return next;
    });
  }

  function handleRestoreRow(rowIdx) {
    setExcludedRows((prev) => {
      const next = new Set(prev);
      next.delete(rowIdx);
      return next;
    });
  }

  function handleExcludeAllUnmatched() {
    setExcludedRows((prev) => {
      const next = new Set(prev);
      activeRows.forEach((row) => {
        if (!row.categoryId) next.add(row.idx);
      });
      return next;
    });
  }

  function handleRestoreAll() {
    setExcludedRows(new Set());
  }

  function getCategoryColor(catId) {
    const cat = categories.find((c) => c.id === catId);
    return cat?.color || '#94a3b8';
  }

  return (
    <div className="space-y-6">
      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 rounded-xl bg-stone-50 px-4 py-2 dark:bg-stone-700/30">
          <span className="text-sm font-medium text-stone-600 dark:text-stone-400">Importing:</span>
          <span className="text-sm font-bold text-stone-900 dark:text-stone-100">{activeRows.length}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 dark:bg-emerald-900/30">
          <span className="text-sm font-medium text-emerald-700">Matched:</span>
          <span className="text-sm font-bold text-emerald-700">{matchedCount}</span>
        </div>
        {unmatchedCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 dark:bg-amber-900/30">
            <span className="text-sm font-medium text-amber-700">Unmatched:</span>
            <span className="text-sm font-bold text-amber-700">{unmatchedCount}</span>
          </div>
        )}
        {pairedCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-violet-50 px-4 py-2 dark:bg-violet-900/30">
            <span className="text-sm font-medium text-violet-700 dark:text-violet-400">Linked pairs:</span>
            <span className="text-sm font-bold text-violet-700 dark:text-violet-400">{Math.round(pairedCount)}</span>
          </div>
        )}
        {excludedCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-2 dark:bg-red-900/30">
            <span className="text-sm font-medium text-red-700">Excluded:</span>
            <span className="text-sm font-bold text-red-700">{excludedCount}</span>
          </div>
        )}

        {/* Filter toggles */}
        <div className="ml-auto flex gap-1 rounded-xl border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-800">
          {['all', 'matched', 'unmatched', ...(excludedCount > 0 ? ['excluded'] : [])].map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-all ${
                filter === f
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk actions for unmatched */}
      {unmatchedCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950/30">
          <span className="text-sm font-medium text-amber-800 dark:text-amber-400">
            {unmatchedCount} unmatched:
          </span>
          <select
            onChange={(e) => e.target.value && handleBulkAssign(e.target.value)}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-700 dark:bg-stone-800 dark:text-stone-100"
            defaultValue=""
          >
            <option value="">Assign to category…</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleExcludeAllUnmatched}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            Remove all unmatched
          </button>
        </div>
      )}

      {/* Restore all excluded */}
      {excludedCount > 0 && filter !== 'excluded' && (
        <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50/50 px-4 py-3 dark:border-stone-700 dark:bg-stone-700/30">
          <span className="text-sm text-stone-600 dark:text-stone-400">
            {excludedCount} row{excludedCount !== 1 ? 's' : ''} excluded from import.
          </span>
          <button
            type="button"
            onClick={handleRestoreAll}
            className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-stone-400 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
          >
            Restore all
          </button>
        </div>
      )}

      {/* Transaction table */}
      <div className="overflow-x-auto rounded-xl border border-stone-200/60 dark:border-stone-700/60">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200/60 bg-stone-50 dark:border-stone-700/60 dark:bg-stone-700/30">
              <th className="px-4 py-2.5 text-left font-medium text-stone-600 w-10">#</th>
              <th className="px-4 py-2.5 text-left font-medium text-stone-600 dark:text-stone-400">Date</th>
              <th className="px-4 py-2.5 text-left font-medium text-stone-600 dark:text-stone-400">Description</th>
              <th className="px-4 py-2.5 text-right font-medium text-stone-600 dark:text-stone-400">Amount</th>
              <th className="px-4 py-2.5 text-left font-medium text-stone-600 min-w-[200px]">Category</th>
              <th className="px-4 py-2.5 text-center font-medium text-stone-600 w-16">Linked</th>
              <th className="px-4 py-2.5 text-center font-medium text-stone-600 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const isExcluded = excludedRows.has(row.idx);
              return (
              <tr
                key={row.idx}
                className={`border-b border-stone-100 last:border-0 transition-colors ${
                  isExcluded
                    ? 'bg-red-50/40 opacity-60 dark:bg-red-900/20'
                    : !row.categoryId ? 'bg-amber-50/30' : ''
                }`}
              >
                <td className="px-4 py-2 text-stone-400 text-xs dark:text-stone-500">{row.idx + 1}</td>
                <td className="px-4 py-2 text-stone-700 whitespace-nowrap dark:text-stone-300">
                  {row.date ? formatDate(row.date) : '—'}
                </td>
                <td className="px-4 py-2 text-stone-700 dark:text-stone-300 max-w-[250px]">
                  <div className="truncate">{row.description || '—'}</div>
                  {row.payee && (
                    <div className="truncate text-xs text-stone-400 dark:text-stone-500">{row.payee}</div>
                  )}
                </td>
                <td className={`px-4 py-2 text-right font-medium whitespace-nowrap ${
                  row.isExpense ? 'text-stone-900' : 'text-emerald-600'
                }`}>
                  {row.amount !== null ? formatCurrency(row.amount) : '—'}
                </td>
                <td className="px-4 py-2">
                  {!isExcluded ? (
                    <div className="flex items-center gap-2">
                      {row.categoryId && (
                        <span
                          className="h-3 w-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: getCategoryColor(row.categoryId) }}
                        />
                      )}
                      <select
                        value={row.categoryId || ''}
                        onChange={(e) => handleCategoryChange(row.idx, e.target.value)}
                        className={`w-full rounded-lg border px-2 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                          row.categoryId
                            ? 'border-stone-200 bg-white text-stone-900 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100'
                            : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                        }`}
                      >
                        <option value="">No category</option>
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>{cat.name} ({cat.type})</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="text-xs italic text-red-400">Excluded</span>
                  )}
                </td>
                <td className="px-2 py-2 text-center">
                  {transferPairs.has(row.idx) && !isExcluded ? (
                    <button
                      type="button"
                      onClick={() => setManualUnpairs((prev) => new Set([...prev, row.idx]))}
                      title={`Linked with row ${transferPairs.get(row.idx) + 1} — click to unpair`}
                      className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-600 transition-colors hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-400 dark:hover:bg-violet-900/60"
                    >
                      ↔ {transferPairs.get(row.idx) + 1}
                    </button>
                  ) : (
                    <span className="text-xs text-stone-300 dark:text-stone-600">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-center">
                  {!isExcluded ? (
                    <button
                      type="button"
                      onClick={() => handleExcludeRow(row.idx)}
                      title="Remove from import"
                      className="rounded-lg p-1 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 focus:outline-none focus:ring-2 focus:ring-red-400"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleRestoreRow(row.idx)}
                      title="Restore to import"
                      className="rounded-lg p-1 text-stone-400 transition-colors hover:bg-emerald-50 hover:text-emerald-600 dark:hover:bg-emerald-900/30 focus:outline-none focus:ring-2 focus:ring-emerald-400"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredRows.length === 0 && (
        <p className="text-center text-sm text-stone-500 py-6 dark:text-stone-400">
          No transactions match the current filter.
        </p>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() => onConfirm(assignments, excludedRows, transferPairs)}
          disabled={activeRows.length === 0}
          className="flex-1 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          Import {activeRows.length} Transaction{activeRows.length !== 1 ? 's' : ''}
        </button>
      </div>
    </div>
  );
}
