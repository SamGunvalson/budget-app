import { useState, useRef, useMemo } from 'react';
import { parseBudgetCSV, formatCurrency, toCents } from '../../utils/helpers';
import { getCategories, createCategory } from '../../services/categories';
import {
  getBudgetPlan,
  createBudgetPlan,
  updateBudgetPlan,
  deleteBudgetItemsForPlan,
  upsertBudgetItems,
} from '../../services/budgets';

const SHORT_MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString('en-US', { month: 'short' }),
);

const GROUPED_TYPE_ORDER = ['income', 'needs', 'wants', 'savings'];
const GROUPED_TYPE_LABELS = { income: 'Income', needs: 'Needs', wants: 'Wants', savings: 'Savings' };

/**
 * Modal for importing an annual budget from a CSV file.
 *
 * Props:
 *   initialYear  – optional starting year (defaults to current year)
 *   categories   – existing category list (from getCategories)
 *   onClose      – close the modal
 *   onImportComplete – callback after a successful import (triggers data reload)
 */
export default function BudgetImportModal({ initialYear, categories, onClose, onImportComplete }) {
  const fileRef = useRef(null);
  const [year, setYear] = useState(initialYear ?? new Date().getFullYear());

  // stages: 'pick' | 'preview' | 'importing' | 'done'
  const [stage, setStage] = useState('pick');
  const [parseError, setParseError] = useState('');
  const [parseWarnings, setParseWarnings] = useState('');
  const [rows, setRows] = useState([]); // from parseBudgetCSV
  const [catResolutions, setCatResolutions] = useState({}); // { name: { action: 'create', type } | { action: 'map', categoryId } }
  const [importError, setImportError] = useState('');
  const [importedCount, setImportedCount] = useState(0);

  // Build lookup for existing categories (case-insensitive name → obj)
  const catByName = useMemo(() => {
    const map = {};
    categories.forEach((c) => {
      map[c.name.toLowerCase()] = c;
    });
    return map;
  }, [categories]);

  // Determine which rows reference unknown categories
  const unknownNames = useMemo(() => {
    const seen = new Set();
    rows.forEach((r) => {
      const key = r.categoryName.toLowerCase();
      if (!catByName[key] && !seen.has(key)) seen.add(r.categoryName);
    });
    return [...seen];
  }, [rows, catByName]);

  // Group existing categories by type for the "Map to Existing" dropdown
  const groupedCategories = useMemo(() =>
    GROUPED_TYPE_ORDER
      .map((type) => ({ type, label: GROUPED_TYPE_LABELS[type], items: categories.filter((c) => c.type === type) }))
      .filter((g) => g.items.length > 0),
  [categories]);

  // ── File selected ──
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      const { rows: parsed, error } = parseBudgetCSV(text);

      if (parsed.length === 0) {
        setParseError(error || 'No data could be parsed from the file.');
        setParseWarnings('');
        setRows([]);
        return;
      }

      // Non-fatal warnings (e.g. some cells invalid) still let the user proceed
      setParseError('');
      setParseWarnings(error || '');
      setRows(parsed);

      // Pre-seed resolutions: default to 'create' with type 'needs'
      const resolutions = {};
      const firstCatId = categories[0]?.id ?? '';
      parsed.forEach((r) => {
        const key = r.categoryName.toLowerCase();
        if (!catByName[key]) {
          resolutions[r.categoryName] = { action: 'create', type: 'needs', categoryId: firstCatId };
        }
      });
      setCatResolutions(resolutions);
      setStage('preview');
    };
    reader.readAsText(file);
  };

  // ── Import handler ──
  const handleImport = async () => {
    setStage('importing');
    setImportError('');

    try {
      // 1. Re-fetch live categories to avoid stale data / duplicate key errors
      const freshCats = await getCategories();
      const liveCatByName = {};
      freshCats.forEach((c) => {
        liveCatByName[c.name.toLowerCase()] = c;
      });

      // 2. Resolve unknown categories: create new or map to existing
      const createdCats = {};
      for (const name of unknownNames) {
        const key = name.toLowerCase();
        const resolution = catResolutions[name] || { action: 'create', type: 'needs' };

        if (resolution.action === 'map') {
          // User chose to map this CSV name to an existing category
          const mapped = freshCats.find((c) => c.id === resolution.categoryId);
          if (mapped) createdCats[key] = mapped;
          continue;
        }

        // action === 'create'
        if (liveCatByName[key]) {
          // Already exists in DB (possibly from a prior partial import)
          createdCats[key] = liveCatByName[key];
          continue;
        }
        const type = resolution.type || 'needs';
        const cat = await createCategory({ name, type, color: '#3B82F6' });
        createdCats[key] = cat;
      }

      // Merged lookup: live DB categories + newly-created
      const allCats = { ...liveCatByName, ...createdCats };

      // 2. For each of the 12 months, replace budget items
      let monthsImported = 0;

      for (let mi = 0; mi < 12; mi++) {
        const monthNum = mi + 1; // 1-12

        // Check if any row has a non-zero value for this month
        const hasData = rows.some((r) => r.monthAmounts[mi] !== 0);
        if (!hasData) continue;

        // Get or create the budget plan
        let plan = await getBudgetPlan(monthNum, year);

        // Compute total income for this month
        const totalIncome = rows.reduce((sum, r) => {
          const cat = allCats[r.categoryName.toLowerCase()];
          if (cat && cat.type === 'income') return sum + Math.max(0, toCents(r.monthAmounts[mi]));
          return sum;
        }, 0);

        if (!plan) {
          plan = await createBudgetPlan({ month: monthNum, year, total_income: totalIncome });
        } else {
          // Clear existing items (replace mode)
          await deleteBudgetItemsForPlan(plan.id);
          await updateBudgetPlan(plan.id, { total_income: totalIncome });
        }

        // Build items array, deduplicating by category_id (last row wins)
        const itemMap = new Map();
        rows.forEach((r) => {
          const cat = allCats[r.categoryName.toLowerCase()];
          if (!cat) return;
          itemMap.set(cat.id, {
            budget_plan_id: plan.id,
            category_id: cat.id,
            planned_amount: Math.max(0, toCents(r.monthAmounts[mi])),
          });
        });
        const items = [...itemMap.values()];

        if (items.length) {
          await upsertBudgetItems(items);
        }

        monthsImported++;
      }

      setImportedCount(monthsImported);
      setStage('done');
    } catch (err) {
      const raw = err.message || '';
      const friendlyMessage =
        raw.includes('budget_items_planned_amount_check')
          ? 'One or more budget amounts were invalid (negative values are not allowed). All negative values have been converted to positive — please try importing again.'
          : raw || 'Import failed.';
      setImportError(friendlyMessage);
      setStage('preview'); // let user retry
    }
  };

  // ── Render ──
  return (
    <div data-modal-open="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="animate-fade-in mx-4 max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-stone-200/60 bg-white p-6 shadow-xl shadow-stone-300/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">Import Budget</h2>
            <input
              type="number"
              min="2000"
              max="2100"
              value={year}
              disabled={stage !== 'pick'}
              onChange={(e) => setYear(Number(e.target.value))}
              className="w-24 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── STAGE: pick ── */}
        {stage === 'pick' && (
          <div className="space-y-4">
            <p className="text-sm text-stone-600 dark:text-stone-300">
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
              >
                Choose CSV File
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            {parseError && (
              <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
              </div>
            )}
          </div>
        )}

        {/* ── STAGE: preview ── */}
        {stage === 'preview' && (
          <div className="space-y-5">
            {/* Warnings */}
            {parseWarnings && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
                <span className="mr-1.5 font-semibold">Warnings:</span>
                <span className="whitespace-pre-wrap">{parseWarnings}</span>
              </div>
            )}

            {/* Import error (retry) */}
            {importError && (
              <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                <span className="mr-1.5">⚠</span>{importError}
              </div>
            )}

            {/* New categories */}
            {unknownNames.length > 0 && (
              <div className="rounded-2xl border border-stone-200/60 bg-stone-50/50 p-4 dark:border-stone-700/60 dark:bg-stone-700/30">
                <h3 className="mb-3 text-lg font-semibold text-stone-900 dark:text-stone-100">
                  New Categories Detected
                </h3>
                <p className="mb-3 text-sm text-stone-600 dark:text-stone-300">
                  These categories don't exist yet. Create each as a new category or map it to an existing one.
                </p>
                <div className="space-y-3">
                  {unknownNames.map((name) => {
                    const res = catResolutions[name] || { action: 'create', type: 'needs' };
                    return (
                      <div key={name} className="flex flex-wrap items-center gap-3">
                        <span className="w-48 truncate text-sm font-medium text-stone-800 dark:text-stone-200">
                          {name}
                        </span>

                        {/* Action toggle */}
                        <div className="flex rounded-xl border border-stone-300 bg-stone-100 p-0.5 dark:border-stone-600 dark:bg-stone-700">
                          <button
                            type="button"
                            onClick={() =>
                              setCatResolutions((prev) => ({ ...prev, [name]: { ...prev[name], action: 'create' } }))
                            }
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                              res.action === 'create'
                                ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-600 dark:text-stone-100'
                                : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
                            }`}
                          >
                            Create New
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setCatResolutions((prev) => ({ ...prev, [name]: { ...prev[name], action: 'map' } }))
                            }
                            disabled={categories.length === 0}
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-40 ${
                              res.action === 'map'
                                ? 'bg-white text-stone-800 shadow-sm dark:bg-stone-600 dark:text-stone-100'
                                : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
                            }`}
                          >
                            Map to Existing
                          </button>
                        </div>

                        {/* Conditional: type selector or existing-category selector */}
                        {res.action === 'create' ? (
                          <select
                            value={res.type || 'needs'}
                            onChange={(e) =>
                              setCatResolutions((prev) => ({ ...prev, [name]: { ...prev[name], type: e.target.value } }))
                            }
                            className="rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2 text-sm text-stone-800 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-200 dark:focus:bg-stone-700"
                          >
                            {GROUPED_TYPE_ORDER.map((t) => (
                              <option key={t} value={t}>
                                {t.charAt(0).toUpperCase() + t.slice(1)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            value={res.categoryId || categories[0]?.id || ''}
                            onChange={(e) =>
                              setCatResolutions((prev) => ({ ...prev, [name]: { ...prev[name], categoryId: e.target.value } }))
                            }
                            className="rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2 text-sm text-stone-800 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-200 dark:focus:bg-stone-700"
                          >
                            {groupedCategories.map((group) => (
                              <optgroup key={group.type} label={group.label}>
                                {group.items.map((cat) => (
                                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Preview table */}
            <div className="overflow-x-auto rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
              <table className="w-full min-w-[800px] text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50/80 dark:border-stone-700 dark:bg-stone-900/80">
                    <th className="sticky left-0 z-10 bg-stone-50/80 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-stone-500 dark:bg-stone-900/80 dark:text-stone-400">
                      Category
                    </th>
                    {SHORT_MONTHS.map((m) => (
                      <th
                        key={m}
                        className="min-w-[80px] px-2 py-3 text-center text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400"
                      >
                        {m}
                      </th>
                    ))}
                    <th className="px-3 py-3 text-right text-xs font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                      Annual
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, idx) => {
                    const annual = r.monthAmounts.reduce((s, v) => s + v, 0);
                    const isNew = !catByName[r.categoryName.toLowerCase()];
                    return (
                      <tr
                        key={idx}
                        className="border-t border-stone-100 hover:bg-amber-50/30 dark:border-stone-700/50 dark:hover:bg-amber-900/10"
                      >
                        <td className="sticky left-0 z-10 bg-white px-4 py-2 dark:bg-stone-800">
                          <span className="font-medium text-stone-800 dark:text-stone-200">
                            {r.categoryName}
                          </span>
                          {isNew && (() => {
                            const res = catResolutions[r.categoryName];
                            if (!res || res.action === 'create') {
                              return (
                                <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-900/50 dark:text-amber-400">
                                  new
                                </span>
                              );
                            }
                            const mappedCat = categories.find((c) => c.id === res.categoryId);
                            return (
                              <span className="ml-2 inline-block rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-700 dark:bg-sky-900/50 dark:text-sky-400">
                                → {mappedCat ? mappedCat.name : 'mapped'}
                              </span>
                            );
                          })()}
                        </td>
                        {r.monthAmounts.map((amt, mi) => (
                          <td
                            key={mi}
                            className="px-2 py-2 text-center text-xs text-stone-700 dark:text-stone-300"
                          >
                            {amt !== 0 ? formatCurrency(toCents(amt)) : '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right text-xs font-semibold text-stone-700 dark:text-stone-300">
                          {formatCurrency(toCents(annual))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => {
                  setStage('pick');
                  setRows([]);
                  setParseError('');
                  setParseWarnings('');
                  setImportError('');
                  if (fileRef.current) fileRef.current.value = '';
                }}
                className="rounded-lg border border-stone-200 bg-white px-6 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              >
                Back
              </button>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-stone-200 bg-white px-6 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleImport}
                  className="rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
                >
                  Import Budget
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STAGE: importing ── */}
        {stage === 'importing' && (
          <div className="flex flex-col items-center gap-4 py-12">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
            <p className="text-sm font-medium text-stone-600 dark:text-stone-300">
              Importing budget data…
            </p>
          </div>
        )}

        {/* ── STAGE: done ── */}
        {stage === 'done' && (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Import Complete</h3>
            <p className="text-sm text-stone-600 dark:text-stone-300">
              Successfully imported <span className="font-semibold">{rows.length}</span> categories across{' '}
              <span className="font-semibold">{importedCount}</span> month{importedCount !== 1 ? 's' : ''} for{' '}
              <span className="font-semibold">{year}</span>.
            </p>
            {unknownNames.length > 0 && (
              <p className="text-sm text-stone-500 dark:text-stone-400">
              </p>
            )}
            <button
              type="button"
              onClick={() => {
                onImportComplete();
                onClose();
              }}
              className="rounded-xl bg-amber-500 px-8 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
