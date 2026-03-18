import { useState, useCallback, useMemo } from 'react';
import { formatCurrency, formatDate } from '../../utils/helpers';
import { normalizeDate, normalizeAmount } from '../../utils/csvParser';

/**
 * ColumnMapper — lets users map spreadsheet columns to transaction fields.
 *
 * Props:
 *  - headers: string[] — column names from the file
 *  - rows: object[] — raw data rows (keyed by header)
 *  - initialMapping: { date, amount, description } — auto-guessed mapping
 *  - onMappingConfirmed({ date, amount, description }, mappedRows): called when user confirms
 *  - onBack(): go back to file upload step
 */
export default function ColumnMapper({ headers, rows, initialMapping, onMappingConfirmed, onBack }) {
  const [splitMode, setSplitMode] = useState(initialMapping?.splitMode || false);
  const [mapping, setMapping] = useState({
    date: initialMapping?.date || '',
    amount: initialMapping?.amount || '',
    payments: initialMapping?.payments || '',
    deposits: initialMapping?.deposits || '',
    description: initialMapping?.description || '',
    payee: initialMapping?.payee || '',
    csvCategory: initialMapping?.csvCategory || '',
    csvAccount: initialMapping?.csvAccount || '',
  });

  const previewRows = useMemo(() => rows.slice(0, 5), [rows]);

  // Resolve a single row to { date, amount(cents), isExpense, description, payee }
  const resolveRow = useCallback((row) => {
    const { date } = normalizeDate(row[mapping.date]);
    const description = mapping.description ? String(row[mapping.description] || '') : '';
    const payee = mapping.payee ? String(row[mapping.payee] || '') : '';

    if (splitMode) {
      // Try payments first, then deposits
      const payRaw = row[mapping.payments];
      const depRaw = row[mapping.deposits];
      const pay = normalizeAmount(payRaw);
      const dep = normalizeAmount(depRaw);

      const hasPayment = pay.cents !== null && pay.cents > 0;
      const hasDeposit = dep.cents !== null && dep.cents > 0;

      if (hasPayment && hasDeposit) {
        // Both sides present — net the difference so e.g. 103 payment / 3 deposit → 100 expense
        const net = pay.cents - dep.cents;
        if (net > 0) {
          return { date: date || '—', amount: net, isExpense: true, description, payee };
        } else if (net < 0) {
          return { date: date || '—', amount: -net, isExpense: false, description, payee };
        } else {
          // Exactly zero — keep as a zero-amount expense
          return { date: date || '—', amount: 0, isExpense: true, description, payee };
        }
      }
      if (hasPayment) {
        return { date: date || '—', amount: pay.cents, isExpense: true, description, payee };
      }
      if (hasDeposit) {
        return { date: date || '—', amount: dep.cents, isExpense: false, description, payee };
      }
      // Both empty / zero — still return a row so it shows in preview
      return { date: date || '—', amount: null, isExpense: true, description, payee };
    }

    // Single amount column
    const { cents, isNegative } = normalizeAmount(row[mapping.amount]);
    return {
      date: date || '—',
      amount: cents,
      isExpense: isNegative,
      description,
      payee,
    };
  }, [mapping, splitMode]);

  // Compute mapped preview
  const mappedPreview = useMemo(() => {
    if (!mapping.date) return [];
    if (splitMode ? !(mapping.payments || mapping.deposits) : !mapping.amount) return [];
    return previewRows.map((row) => resolveRow(row));
  }, [resolveRow, splitMode, mapping, previewRows]);

  // Compute summary stats across ALL rows (not just preview)
  const importSummary = useMemo(() => {
    if (!mapping.date) return null;
    if (splitMode ? !(mapping.payments || mapping.deposits) : !mapping.amount) return null;
    let expenseCount = 0, depositCount = 0, expenseTotal = 0, depositTotal = 0;
    for (const row of rows) {
      const resolved = resolveRow(row);
      if (resolved.amount === null || resolved.amount === 0) continue;
      if (resolved.isExpense) {
        expenseCount++;
        expenseTotal += resolved.amount;
      } else {
        depositCount++;
        depositTotal += resolved.amount;
      }
    }
    return { expenseCount, depositCount, expenseTotal, depositTotal };
  }, [resolveRow, splitMode, mapping, rows]);

  const canConfirm = mapping.date && (splitMode ? (mapping.payments || mapping.deposits) : mapping.amount);

  function handleConfirm() {
    // Map all rows, attaching a pre-resolved isExpense flag
    const mappedRows = rows.map((row) => {
      const resolved = resolveRow(row);
      return {
        date: row[mapping.date],
        amount: resolved.amount, // already in cents
        isExpense: resolved.isExpense,
        description: mapping.description ? String(row[mapping.description] || '') : '',
        payee: mapping.payee ? String(row[mapping.payee] || '') : '',
        csvCategory: mapping.csvCategory ? String(row[mapping.csvCategory] || '') : '',
        csvAccount: mapping.csvAccount ? String(row[mapping.csvAccount] || '') : '',
        _amountPreResolved: true, // tells downstream the amount is already in cents
        _fromSplitColumns: splitMode, // direction is authoritative when from split payment/deposit cols
      };
    });
    onMappingConfirmed(mapping, mappedRows);
  }

  return (
    <div className="space-y-6">
      {/* Amount mode toggle */}
      <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50/50 px-4 py-3 dark:border-stone-700 dark:bg-stone-700/30">
        <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Amount columns:</span>
        <div className="flex gap-1 rounded-xl border border-stone-200 bg-white p-0.5 dark:border-stone-700 dark:bg-stone-800">
          <button
            type="button"
            onClick={() => setSplitMode(false)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              !splitMode ? 'bg-amber-500 text-white shadow-sm' : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300'
            }`}
          >
            Single Column
          </button>
          <button
            type="button"
            onClick={() => setSplitMode(true)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              splitMode ? 'bg-amber-500 text-white shadow-sm' : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300'
            }`}
          >
            Payments &amp; Deposits
          </button>
        </div>
      </div>

      {/* Column selectors */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
            Date Column <span className="text-red-500">*</span>
          </label>
          <select
            value={mapping.date}
            onChange={(e) => setMapping((m) => ({ ...m, date: e.target.value }))}
            className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
          >
            <option value="">Select column…</option>
            {headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>

        {splitMode ? (
          <>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                Payments Column <span className="text-red-500">*</span>
              </label>
              <select
                value={mapping.payments}
                onChange={(e) => setMapping((m) => ({ ...m, payments: e.target.value }))}
                className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
              >
                <option value="">Select column…</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <p className="text-xs text-stone-400 dark:text-stone-500">Money leaving the account</p>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                Deposits Column <span className="text-red-500">*</span>
              </label>
              <select
                value={mapping.deposits}
                onChange={(e) => setMapping((m) => ({ ...m, deposits: e.target.value }))}
                className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
              >
                <option value="">Select column…</option>
                {headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <p className="text-xs text-stone-400 dark:text-stone-500">Money coming into the account</p>
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
              Amount Column <span className="text-red-500">*</span>
            </label>
            <select
              value={mapping.amount}
              onChange={(e) => setMapping((m) => ({ ...m, amount: e.target.value }))}
              className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
            >
              <option value="">Select column…</option>
              {headers.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
        )}

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
            Description Column
          </label>
          <select
            value={mapping.description}
            onChange={(e) => setMapping((m) => ({ ...m, description: e.target.value }))}
            className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
          >
            <option value="">None (optional)</option>
            {headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
            Payee Column
          </label>
          <select
            value={mapping.payee}
            onChange={(e) => setMapping((m) => ({ ...m, payee: e.target.value }))}
            className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
          >
            <option value="">None (optional)</option>
            {headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <p className="text-xs text-stone-400 dark:text-stone-500">Who the payment is to/from</p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
            Category Column
          </label>
          <select
            value={mapping.csvCategory}
            onChange={(e) => setMapping((m) => ({ ...m, csvCategory: e.target.value }))}
            className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
          >
            <option value="">None (optional)</option>
            {headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <p className="text-xs text-stone-400 dark:text-stone-500">Pre-assigned category from spreadsheet</p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
            Account Column
          </label>
          <select
            value={mapping.csvAccount}
            onChange={(e) => setMapping((m) => ({ ...m, csvAccount: e.target.value }))}
            className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
          >
            <option value="">None (optional)</option>
            {headers.map((h) => (
              <option key={h} value={h}>{h}</option>
            ))}
          </select>
          <p className="text-xs text-stone-400 dark:text-stone-500">Account name from spreadsheet</p>
        </div>
      </div>

      {/* Raw file preview */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-stone-700 dark:text-stone-300">File Preview (first 5 rows)</h3>
        <div className="overflow-x-auto rounded-xl border border-stone-200/60 dark:border-stone-700/60">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200/60 bg-stone-50 dark:border-stone-700/60 dark:bg-stone-700/30">
                {headers.map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium text-stone-600 dark:text-stone-400">
                    {h}
                    {h === mapping.date && (
                      <span className="ml-1.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">DATE</span>
                    )}
                    {!splitMode && h === mapping.amount && (
                      <span className="ml-1.5 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">AMT</span>
                    )}
                    {splitMode && h === mapping.payments && (
                      <span className="ml-1.5 rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">PAY</span>
                    )}
                    {splitMode && h === mapping.deposits && (
                      <span className="ml-1.5 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">DEP</span>
                    )}
                    {h === mapping.description && (
                      <span className="ml-1.5 rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700">DESC</span>
                    )}
                    {h === mapping.payee && (
                      <span className="ml-1.5 rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">PAYEE</span>
                    )}
                    {h === mapping.csvCategory && (
                      <span className="ml-1.5 rounded-md bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">CAT</span>
                    )}
                    {h === mapping.csvAccount && (
                      <span className="ml-1.5 rounded-md bg-cyan-100 px-1.5 py-0.5 text-[10px] font-bold text-cyan-700">ACCT</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i} className="border-b border-stone-100 last:border-0 dark:border-stone-700">
                  {headers.map((h) => (
                    <td key={h} className="px-4 py-2 text-stone-700 dark:text-stone-300">
                      {String(row[h] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mapped preview */}
      {mappedPreview.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-stone-700 dark:text-stone-300">Mapped Preview</h3>
          <div className="overflow-x-auto rounded-xl border border-stone-200/60 dark:border-stone-700/60">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200/60 bg-stone-50 dark:border-stone-700/60 dark:bg-stone-700/30">
                  <th className="px-4 py-2.5 text-left font-medium text-stone-600 dark:text-stone-400">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium text-stone-600 dark:text-stone-400">Amount</th>
                  <th className="px-4 py-2.5 text-left font-medium text-stone-600 dark:text-stone-400">Description</th>
                  <th className="px-4 py-2.5 text-left font-medium text-stone-600 dark:text-stone-400">Type</th>
                </tr>
              </thead>
              <tbody>
                {mappedPreview.map((row, i) => (
                  <tr key={i} className="border-b border-stone-100 last:border-0 dark:border-stone-700">
                    <td className="px-4 py-2 text-stone-700 dark:text-stone-300">{row.date !== '—' ? formatDate(row.date) : '—'}</td>
                    <td className={`px-4 py-2 font-medium ${row.isExpense ? 'text-stone-900' : 'text-emerald-600'}`}>
                      {row.amount !== null ? formatCurrency(Math.abs(row.amount)) : '—'}
                    </td>
                    <td className="px-4 py-2 text-stone-700 dark:text-stone-300">{row.description || '—'}</td>
                    <td className="px-4 py-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                        row.isExpense
                          ? 'bg-red-50 text-red-700'
                          : 'bg-emerald-50 text-emerald-700'
                      }`}>
                        {row.isExpense ? 'Expense' : 'Income'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-stone-500 dark:text-stone-400">
            Showing {mappedPreview.length} of {rows.length} rows
          </p>
        </div>
      )}

      {/* Import summary across all rows */}
      {importSummary && (
        <div className="rounded-xl border border-stone-200/60 bg-stone-50/50 px-5 py-4 dark:border-stone-700/60 dark:bg-stone-700/30">
          <h3 className="mb-2 text-sm font-semibold text-stone-700 dark:text-stone-300">Import Summary (all {rows.length} rows)</h3>
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <span className="font-medium text-red-600 dark:text-red-400">{importSummary.expenseCount}</span>
              <span className="text-stone-500 dark:text-stone-400"> expenses totaling </span>
              <span className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(importSummary.expenseTotal)}</span>
            </div>
            <div>
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{importSummary.depositCount}</span>
              <span className="text-stone-500 dark:text-stone-400"> deposits totaling </span>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{formatCurrency(importSummary.depositTotal)}</span>
            </div>
          </div>
          {importSummary.depositCount === 0 && importSummary.expenseCount > 5 && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
              ⚠ No deposits detected — if this is a checking/savings account, the payment and deposit columns may be swapped. Check the column mapping above.
            </p>
          )}
          {importSummary.expenseCount === 0 && importSummary.depositCount > 5 && (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
              ⚠ No expenses detected — if this is a checking/savings account, the payment and deposit columns may be swapped. Check the column mapping above.
            </p>
          )}
        </div>
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
          onClick={handleConfirm}
          disabled={!canConfirm}
          className="flex-1 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
        >
          Continue to Category Matching
        </button>
      </div>
    </div>
  );
}
