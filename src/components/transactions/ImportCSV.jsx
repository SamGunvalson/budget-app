import { useState, useCallback, useEffect } from 'react';
import FileUploader from './FileUploader';
import ColumnMapper from './ColumnMapper';
import AccountMatcher from './AccountMatcher';
import CategoryMatcher from './CategoryMatcher';
import { parseSpreadsheetFile, guessColumnMapping } from '../../utils/csvParser';
import {
  validateAndTransform,
  checkDuplicates,
  bulkInsertTransactions,
  generateImportReport,
  downloadFile,
} from '../../services/import';

// Wizard steps
const STEPS = {
  UPLOAD: 'upload',
  MAP: 'map',
  ACCOUNT: 'account',
  CATEGORY: 'category',
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
export default function ImportCSV({ categories, accounts, onComplete, onClose }) {
  const [step, setStep] = useState(STEPS.UPLOAD);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState('');

  // Local copy of accounts so inline-created accounts appear immediately in dropdowns
  const [localAccounts, setLocalAccounts] = useState(accounts || []);

  // Sync with parent when the accounts prop updates (e.g. async fetch completes)
  useEffect(() => {
    if (accounts?.length) {
      setLocalAccounts((prev) => {
        // Merge: keep any locally-created accounts that aren't in the prop yet
        const propIds = new Set(accounts.map((a) => a.id));
        const localOnly = prev.filter((a) => !propIds.has(a.id));
        return [...accounts, ...localOnly];
      });
    }
  }, [accounts]);

  const handleAccountCreated = useCallback((newAccount) => {
    setLocalAccounts((prev) => [...prev, newAccount]);
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
  const [duplicateWarnings, setDuplicateWarnings] = useState([]);

  // ── Step 1: File upload ──
  const handleFileSelected = useCallback(async (file) => {
    setIsParsing(true);
    setParseError('');

    const result = await parseSpreadsheetFile(file);

    if (result.error) {
      setParseError(result.error);
      setIsParsing(false);
      return;
    }

    setHeaders(result.headers);
    setRawRows(result.rows);
    setGuessedMapping(guessColumnMapping(result.headers));
    setIsParsing(false);
    setStep(STEPS.MAP);
  }, []);

  // ── Step 2: Column mapping confirmed ──
  const handleMappingConfirmed = useCallback((_mapping, mapped) => {
    setMappedRows(mapped);
    // If any rows have csvAccount data, go to account matching; otherwise skip
    const hasAccountData = mapped.some((r) => r.csvAccount);
    setStep(hasAccountData ? STEPS.ACCOUNT : STEPS.CATEGORY);
  }, []);

  // ── Step 2b: Account matching confirmed ──
  const handleAccountConfirmed = useCallback((assignments) => {
    setAccountMap(assignments);
    setStep(STEPS.CATEGORY);
  }, []);

  // ── Step 3: Category matching confirmed → import ──
  const handleCategoryConfirmed = useCallback(async (assignments, excludedRows = new Set(), transferPairs = new Map()) => {
    setStep(STEPS.IMPORTING);
    setImportProgress('Validating transactions…');

    // Filter out excluded rows before validation
    const includedRows = mappedRows.filter((_, idx) => !excludedRows.has(idx));

    // Re-index assignments and transfer pairs to match the filtered rows
    const reindexedAssignments = {};
    const origToNew = new Map();
    let newIdx = 0;
    mappedRows.forEach((_, origIdx) => {
      if (!excludedRows.has(origIdx)) {
        origToNew.set(origIdx, newIdx);
        if (assignments[origIdx]) {
          reindexedAssignments[newIdx] = assignments[origIdx];
        }
        newIdx++;
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
    const { valid, errors: validationErrors } = validateAndTransform(
      includedRows,
      categories,
      reindexedAssignments,
      accountMap
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

    // Check duplicates
    setImportProgress('Checking for duplicates…');
    const dupes = await checkDuplicates(valid);
    if (dupes.length > 0) {
      setDuplicateWarnings(dupes);
    }

    // Bulk insert
    setImportProgress(`Importing ${valid.length} transactions…`);
    const result = await bulkInsertTransactions(valid, reindexedPairs);

    setImportResult({
      ...result,
      validRows: valid,
      invalidRows: validationErrors,
    });
    setStep(STEPS.RESULT);
  }, [mappedRows, categories, accountMap]);

  // ── Download report ──
  const handleDownloadReport = useCallback(() => {
    if (!importResult) return;
    const csv = generateImportReport(importResult);
    downloadFile(csv, `import-report-${new Date().toISOString().split('T')[0]}.csv`);
  }, [importResult]);

  // ── Step indicator ──
  const stepLabels = [
    { key: STEPS.UPLOAD, label: 'Upload' },
    { key: STEPS.MAP, label: 'Map Columns' },
    { key: STEPS.ACCOUNT, label: 'Accounts' },
    { key: STEPS.CATEGORY, label: 'Categories' },
    { key: STEPS.RESULT, label: 'Results' },
  ];

  const isStepActive = (s) => {
    const order = [STEPS.UPLOAD, STEPS.MAP, STEPS.ACCOUNT, STEPS.CATEGORY, STEPS.IMPORTING, STEPS.RESULT];
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
          onConfirm={handleCategoryConfirmed}
          onBack={() => {
            const hasAccountData = mappedRows.some((r) => r.csvAccount);
            setStep(hasAccountData ? STEPS.ACCOUNT : STEPS.MAP);
          }}
        />
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
                  {importResult.inserted > 0 ? 'Import Complete' : 'Import Failed'}
                </h3>
                <p className="text-sm text-stone-500 dark:text-stone-400">
                  {importResult.inserted > 0
                    ? `Successfully imported ${importResult.inserted} transaction${importResult.inserted === 1 ? '' : 's'}.`
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

          {/* Duplicate warnings */}
          {duplicateWarnings.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-950">
              <p className="text-sm font-semibold text-amber-800 mb-1 dark:text-amber-400">
                ⚠ Potential Duplicates Detected
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400">
                {duplicateWarnings.length} transaction(s) may already exist (same date and amount).
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
                    Row {err.rowIndex + 2}: <span className="font-medium">{err.field}</span> — {err.message}
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
