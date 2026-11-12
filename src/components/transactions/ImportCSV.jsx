import { useState, useCallback, useMemo } from 'react';
import { isAvailableCategory } from '../../utils/categoryArchive';
import { formatCurrency, formatDate, getTodayString } from '../../utils/helpers';
import FileUploader from './FileUploader';
import ColumnMapper from './ColumnMapper';
import AccountMatcher from './AccountMatcher';
import CategoryMatcher from './CategoryMatcher';
import { parseSpreadsheetFile, guessColumnMapping } from '../../utils/csvParser';
import {
  validateAndTransform,
  checkDuplicates,
  bulkInsertTransactions,
  groupDuplicatesForReview,
  generateImportReport,
  downloadFile,
} from '../../services/import';

// Wizard steps
const STEPS = {
  UPLOAD: 'upload',
  MAP: 'map',
  ACCOUNT: 'account',
  CATEGORY: 'category',
  DUPLICATES: 'duplicates',
  IMPORTING: 'importing',
  RESULT: 'result',
};

/**
 * ImportCSV — multi-step wizard for bulk-importing transactions from CSV/Excel.
 *
 * Props:
 *  - categories: object[] — user's categories
 *  - onComplete(): called after successful import to refresh parent data
 *  - onClose(): close the import modal
 */
export default function ImportCSV({ categories: allCategories, accounts, onComplete, onClose }) {
  const categories = useMemo(() => (allCategories ?? []).filter(isAvailableCategory), [allCategories]);
  const [step, setStep] = useState(STEPS.UPLOAD);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');

  const [localAccountAdditions, setLocalAccountAdditions] = useState([]);
  const parentAccounts = accounts ?? [];

  // Once the parent/server snapshot includes an inline-created account, stop
  // treating the local copy as authoritative so later server removals stay removed.
  const acknowledgedIds = new Set(
    localAccountAdditions
      .filter((account) => parentAccounts.some((parent) => parent.id === account.id))
      .map((account) => account.id),
  );
  if (acknowledgedIds.size > 0) {
    setLocalAccountAdditions((previous) =>
      previous.filter((account) => !acknowledgedIds.has(account.id)),
    );
  }
  const accountById = new Map(parentAccounts.map((account) => [account.id, account]));
  for (const account of localAccountAdditions) {
    if (!acknowledgedIds.has(account.id) && !accountById.has(account.id)) {
      accountById.set(account.id, account);
    }
  }
  const localAccounts = [...accountById.values()];

  const handleAccountCreated = useCallback((newAccount) => {
    setLocalAccountAdditions((prev) =>
      prev.some((account) => account.id === newAccount.id)
        ? prev
        : [...prev, newAccount],
    );
  }, []);

  // File data
  const [headers, setHeaders] = useState([]);
  const [rawRows, setRawRows] = useState([]);
  const [guessedMapping, setGuessedMapping] = useState(null);

  // Mapped data
  const [mappedRows, setMappedRows] = useState([]);

  // Account assignments: { csvAccountName: accountId }
  const [accountMap, setAccountMap] = useState({});

  // Import state
  const [importProgress, setImportProgress] = useState('');
  const [importResult, setImportResult] = useState(null);
  // Set when possible duplicates were found: the import pauses for review.
  // { valid, validationErrors, transferPairs, duplicates }
  const [pendingImport, setPendingImport] = useState(null);
  // Keys of duplicate groups the user chose to import anyway
  const [includedDuplicates, setIncludedDuplicates] = useState(new Set());
  // CategoryMatcher's working state as of its last confirm, so coming back
  // from the duplicate review does not discard the user's category work.
  const [categoryMatcherState, setCategoryMatcherState] = useState(null);

  // ── Step 1: File upload ──
  const handleFileSelected = useCallback(async (file) => {
    setIsParsing(true);
    setParseError('');

    try {
      const result = await parseSpreadsheetFile(file);

      if (result.error) {
        setParseError(result.error);
        return;
      }

      const guessed = guessColumnMapping(result.headers);
      setHeaders(result.headers);
      setRawRows(result.rows);
      setGuessedMapping(guessed);
      setStep(STEPS.MAP);
    } catch (err) {
      setParseError(`Failed to read file: ${err?.message || 'Unknown error'}`);
    } finally {
      setIsParsing(false);
    }
  }, []);

  // ── Step 2: Column mapping confirmed ──
  const handleMappingConfirmed = useCallback((_mapping, mapped) => {
    setMappedRows(mapped);
    // Saved category work is keyed by row index, so it is stale for new rows.
    setCategoryMatcherState(null);
    // If any rows have csvAccount data, go to account matching; otherwise skip
    const hasAccountData = mapped.some((r) => r.csvAccount);
    setStep(hasAccountData ? STEPS.ACCOUNT : STEPS.CATEGORY);
  }, []);

  // ── Step 2b: Account matching confirmed ──
  const handleAccountConfirmed = useCallback((assignments) => {
    setAccountMap(assignments);
    setStep(STEPS.CATEGORY);
  }, []);

  // Any failure during validation/duplicate check/insert ends on the result
  // step with the error instead of leaving the spinner up.
  const showImportError = useCallback((err, invalidRows = [], failed = 0) => {
    setImportResult({
      inserted: 0,
      failed,
      errors: [err?.message || 'Import failed unexpectedly.'],
      validRows: [],
      invalidRows,
    });
    setStep(STEPS.RESULT);
  }, []);

  // ── Insert the chosen rows and show the result ──
  const runInsert = useCallback(async (rowsToInsert, transferPairs, invalidRows, skippedDuplicates) => {
    setStep(STEPS.IMPORTING);
    try {
      if (rowsToInsert.length === 0) {
        setImportResult({ inserted: 0, failed: 0, errors: [], validRows: [], invalidRows, skippedDuplicates });
        setStep(STEPS.RESULT);
        return;
      }
      setImportProgress(`Importing ${rowsToInsert.length} transactions…`);
      const result = await bulkInsertTransactions(rowsToInsert, transferPairs);
      setImportResult({ ...result, validRows: rowsToInsert, invalidRows, skippedDuplicates });
      setStep(STEPS.RESULT);
    } catch (err) {
      showImportError(err, invalidRows, rowsToInsert.length);
    }
  }, [showImportError]);

  // ── Step 3: Category matching confirmed → validate, check duplicates, import ──
  const handleCategoryConfirmed = useCallback(async (assignments, excludedRows = new Set(), transferPairs = new Map(), matcherState = null) => {
    setCategoryMatcherState(matcherState);
    setStep(STEPS.IMPORTING);
    setImportProgress('Validating transactions…');

    let validationErrors = [];
    try {
      // Filter out excluded rows before validation
      const includedRows = mappedRows.filter((_, idx) => !excludedRows.has(idx));

      // Re-index assignments and transfer pairs to match the filtered rows
      const reindexedAssignments = {};
      const origToNew = new Map();
      const newToOrig = [];
      mappedRows.forEach((_, origIdx) => {
        if (!excludedRows.has(origIdx)) {
          const newIdx = newToOrig.length;
          origToNew.set(origIdx, newIdx);
          newToOrig.push(origIdx);
          if (assignments[origIdx]) {
            reindexedAssignments[newIdx] = assignments[origIdx];
          }
        }
      });

      // Re-index transfer pairs (orig indices → new indices)
      const reindexedPairs = new Map();
      for (const [origA, origB] of transferPairs.entries()) {
        const a = origToNew.get(origA);
        const b = origToNew.get(origB);
        if (a !== undefined && b !== undefined) {
          reindexedPairs.set(a, b);
        }
      }

      // Validate & transform
      const { valid, errors } = validateAndTransform(
        includedRows,
        categories,
        reindexedAssignments,
        accountMap
      );
      // Report errors against the row's position in the file, not in the
      // filtered list (rowIndex -1 is a file-level error and stays as is).
      validationErrors = errors.map((e) =>
        e.rowIndex >= 0 ? { ...e, rowIndex: newToOrig[e.rowIndex] } : e
      );

      if (valid.length === 0) {
        setImportResult({
          inserted: 0,
          failed: validationErrors.length,
          errors: ['No valid transactions to import.'],
          validRows: [],
          invalidRows: validationErrors,
        });
        setStep(STEPS.RESULT);
        return;
      }

      // Check duplicates — a failed check throws, so nothing is inserted blind.
      setImportProgress('Checking for duplicates…');
      const duplicates = await checkDuplicates(valid);
      if (duplicates.length > 0) {
        // Pause: possible duplicates are skipped unless the user opts them in.
        setPendingImport({ valid, validationErrors, transferPairs: reindexedPairs, duplicates });
        setIncludedDuplicates(new Set());
        setStep(STEPS.DUPLICATES);
        return;
      }

      await runInsert(valid, reindexedPairs, validationErrors, 0);
    } catch (err) {
      showImportError(err, validationErrors);
    }
  }, [mappedRows, categories, accountMap, runInsert, showImportError]);

  // ── Duplicate review data ──
  // Each group is one possible duplicate, or both legs of a transfer pair when
  // either leg is a possible duplicate, so a pair is skipped or kept together.
  const duplicateGroups = useMemo(
    () =>
      pendingImport
        ? groupDuplicatesForReview(pendingImport.valid, pendingImport.duplicates, pendingImport.transferPairs)
        : [],
    [pendingImport]
  );
  const reviewRowCount = duplicateGroups.reduce((sum, group) => sum + group.rows.length, 0);
  const skippedCount = duplicateGroups
    .filter((group) => !includedDuplicates.has(group.key))
    .reduce((sum, group) => sum + group.rows.length, 0);
  const importCount = pendingImport ? pendingImport.valid.length - skippedCount : 0;
  const hasPairedDuplicates = duplicateGroups.some((group) => group.rows.length > 1);

  // ── Step 3b: Duplicate review confirmed → import ──
  const handleDuplicatesConfirmed = useCallback(() => {
    if (!pendingImport) return;
    const { valid, validationErrors, transferPairs } = pendingImport;
    // A group is one duplicate, or both legs of a transfer pair — never one leg.
    const skipped = new Set(
      duplicateGroups
        .filter((group) => !includedDuplicates.has(group.key))
        .flatMap((group) => group.rows.map((tx) => tx._rowIndex))
    );
    const rowsToInsert = valid.filter((tx) => !skipped.has(tx._rowIndex));
    setPendingImport(null);
    runInsert(rowsToInsert, transferPairs, validationErrors, skipped.size);
  }, [pendingImport, duplicateGroups, includedDuplicates, runInsert]);

  const toggleDuplicate = useCallback((groupKey) => {
    setIncludedDuplicates((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  // ── Download report ──
  const handleDownloadReport = useCallback(() => {
    if (!importResult) return;
    const csv = generateImportReport(importResult);
    downloadFile(csv, `import-report-${getTodayString()}.csv`);
  }, [importResult]);

  const skippedDuplicates = importResult?.skippedDuplicates || 0;
  const onlySkipped = !!importResult && importResult.inserted === 0 && importResult.failed === 0 && skippedDuplicates > 0;

  // ── Step indicator ──
  const stepLabels = [
    { key: STEPS.UPLOAD, label: 'Upload' },
    { key: STEPS.MAP, label: 'Map Columns' },
    { key: STEPS.ACCOUNT, label: 'Accounts' },
    { key: STEPS.CATEGORY, label: 'Categories' },
    { key: STEPS.RESULT, label: 'Results' },
  ];

  const isStepActive = (s) => {
    const order = [STEPS.UPLOAD, STEPS.MAP, STEPS.ACCOUNT, STEPS.CATEGORY, STEPS.DUPLICATES, STEPS.IMPORTING, STEPS.RESULT];
    return order.indexOf(step) >= order.indexOf(s);
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {stepLabels.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              isStepActive(s.key)
                ? 'bg-amber-500 text-white'
                : 'bg-stone-200 text-stone-500 dark:bg-stone-700 dark:text-stone-400'
            }`}>
              {i + 1}
            </div>
            <span className={`text-sm font-medium transition-colors ${
              isStepActive(s.key) ? 'text-stone-900 dark:text-stone-100' : 'text-stone-400 dark:text-stone-500'
            }`}>
              {s.label}
            </span>
            {i < stepLabels.length - 1 && (
              <div className={`h-px w-6 transition-colors ${
                isStepActive(stepLabels[i + 1].key) ? 'bg-amber-400' : 'bg-stone-200 dark:bg-stone-700'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === STEPS.UPLOAD && (
        <div>
          <p className="mb-4 text-sm text-stone-600 dark:text-stone-400">
            Upload a CSV or Excel file with your transactions. The file should have columns for date, amount, and optionally a description.
          </p>
          <FileUploader onFileSelected={handleFileSelected} isLoading={isParsing} />
          {parseError && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
              <span className="mr-1.5">⚠</span>{parseError}
            </div>
          )}
        </div>
      )}

      {step === STEPS.MAP && (
        <ColumnMapper
          headers={headers}
          rows={rawRows}
          initialMapping={guessedMapping}
          onMappingConfirmed={handleMappingConfirmed}
          onBack={() => setStep(STEPS.UPLOAD)}
        />
      )}

      {step === STEPS.ACCOUNT && (
        <AccountMatcher
          mappedRows={mappedRows}
          accounts={localAccounts}
          onConfirm={handleAccountConfirmed}
          onBack={() => setStep(STEPS.MAP)}
          onAccountCreated={handleAccountCreated}
        />
      )}

      {step === STEPS.CATEGORY && (
        <CategoryMatcher
          mappedRows={mappedRows}
          categories={categories}
          initialState={categoryMatcherState}
          onConfirm={handleCategoryConfirmed}
          onBack={() => {
            const hasAccountData = mappedRows.some((r) => r.csvAccount);
            setStep(hasAccountData ? STEPS.ACCOUNT : STEPS.MAP);
          }}
        />
      )}

      {step === STEPS.DUPLICATES && pendingImport && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
            <p className="mb-1 text-sm font-semibold text-amber-800 dark:text-amber-400">
              ⚠ Possible Duplicates Found
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {reviewRowCount} of {pendingImport.valid.length} transaction{pendingImport.valid.length === 1 ? '' : 's'} match
              an existing transaction with the same date and amount{hasPairedDuplicates ? ', or are the other half of a linked transfer that does' : ''}.
              They will be skipped unless you tick them below.
            </p>
          </div>

          <div className="rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
            <label className="flex cursor-pointer items-center gap-3 border-b border-stone-200/60 px-4 py-2.5 text-sm font-medium text-stone-700 dark:border-stone-700/60 dark:text-stone-300">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700"
                checked={includedDuplicates.size === duplicateGroups.length}
                onChange={(e) =>
                  setIncludedDuplicates(e.target.checked ? new Set(duplicateGroups.map((group) => group.key)) : new Set())
                }
              />
              Import all of these anyway
            </label>
            <ul className="max-h-64 divide-y divide-stone-200/60 overflow-y-auto dark:divide-stone-700/60">
              {duplicateGroups.map((group) => (
                <li key={group.key}>
                  <label className="flex cursor-pointer items-center gap-3 px-4 py-2 text-sm text-stone-700 dark:text-stone-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 rounded border-stone-300 text-amber-500 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700"
                      checked={includedDuplicates.has(group.key)}
                      onChange={() => toggleDuplicate(group.key)}
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      {group.rows.length > 1 && (
                        <span className="block text-xs font-medium text-violet-600 dark:text-violet-400">
                          ↔ Linked transfer — imported or skipped together
                        </span>
                      )}
                      {group.rows.map((tx) => (
                        <span key={tx._rowIndex} className="flex items-center gap-3">
                          <span className="w-24 shrink-0 text-stone-500 dark:text-stone-400">{formatDate(tx.transaction_date)}</span>
                          <span className="min-w-0 flex-1 truncate">{tx.description || tx.payee || '—'}</span>
                          <span className={`shrink-0 font-medium ${tx.is_income ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-900 dark:text-stone-100'}`}>
                            {formatCurrency(tx.amount)}
                          </span>
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setPendingImport(null);
                setStep(STEPS.CATEGORY);
              }}
              className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleDuplicatesConfirmed}
              className="flex-1 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
            >
              {importCount > 0
                ? `Import ${importCount} Transaction${importCount === 1 ? '' : 's'}${skippedCount > 0 ? `, Skip ${skippedCount}` : ''}`
                : `Skip All ${skippedCount} and Finish`}
            </button>
          </div>
        </div>
      )}

      {step === STEPS.IMPORTING && (
        <div className="flex flex-col items-center justify-center py-12">
          <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
          <p className="text-sm font-medium text-stone-700 dark:text-stone-300">{importProgress}</p>
        </div>
      )}

      {step === STEPS.RESULT && importResult && (
        <div className="space-y-6">
          {/* Summary card */}
          <div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
            <div className="flex items-center gap-3 mb-4">
              {importResult.inserted > 0 ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100">
                  <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100">
                  <svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </div>
              )}
              <div>
                <h3 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  {importResult.inserted > 0 ? 'Import Complete' : onlySkipped ? 'Nothing Imported' : 'Import Failed'}
                </h3>
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  {importResult.inserted > 0
                    ? `Successfully imported ${importResult.inserted} transaction${importResult.inserted === 1 ? '' : 's'}.`
                    : onlySkipped
                      ? 'Every transaction was skipped as a possible duplicate.'
                      : 'No transactions were imported.'}
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-xl bg-emerald-50 px-4 py-3 text-center dark:bg-emerald-900/30">
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{importResult.inserted}</p>
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Imported</p>
              </div>
              <div className="rounded-xl bg-red-50 px-4 py-3 text-center dark:bg-red-900/30">
                <p className="text-2xl font-bold text-red-700 dark:text-red-400">{importResult.failed}</p>
                <p className="text-xs font-medium text-red-600 dark:text-red-400">Failed</p>
              </div>
              <div className="rounded-xl bg-stone-50 px-4 py-3 text-center dark:bg-stone-700/30">
                <p className="text-2xl font-bold text-stone-700 dark:text-stone-300">{importResult.invalidRows?.length || 0}</p>
                <p className="text-xs font-medium text-stone-500 dark:text-stone-400">Validation Errors</p>
              </div>
            </div>
          </div>

          {/* Skipped duplicates */}
          {skippedDuplicates > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
              <p className="text-sm font-semibold text-amber-800 mb-1 dark:text-amber-400">
                ⚠ Possible Duplicates Skipped
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {skippedDuplicates} transaction{skippedDuplicates === 1 ? ' was' : 's were'} not imported because a transaction with the same date and amount already exists, or because it is the other half of a linked transfer that does.
              </p>
            </div>
          )}

          {/* Error details */}
          {importResult.errors?.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950">
              <p className="text-sm font-semibold text-red-800 mb-2 dark:text-red-400">Errors</p>
              <ul className="space-y-1">
                {importResult.errors.map((err, i) => (
                  <li key={i} className="text-xs text-red-700 dark:text-red-400">• {err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Validation error details */}
          {importResult.invalidRows?.length > 0 && (
            <div className="rounded-xl border border-stone-200/60 bg-stone-50 p-4 dark:border-stone-700/60 dark:bg-stone-700/30">
              <p className="text-sm font-semibold text-stone-800 mb-2 dark:text-stone-200">Invalid Rows</p>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {importResult.invalidRows.map((err, i) => (
                  <p key={i} className="text-xs text-stone-600 dark:text-stone-400">
                    {err.rowIndex >= 0 ? `Row ${err.rowIndex + 2}` : 'File'}: <span className="font-medium">{err.field}</span> — {err.message}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleDownloadReport}
              className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
            >
              <span className="flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download Report
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                onComplete();
                onClose();
              }}
              className="flex-1 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
