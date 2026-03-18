import { useState, useMemo } from 'react';
import { ACCOUNT_TYPES, createAccount } from '../../services/accounts';
import { maskAccountName } from '../../utils/helpers';

const ACCOUNT_TYPE_OPTIONS = Object.entries(ACCOUNT_TYPES).map(([value, { label, group }]) => ({
  value,
  label,
  group,
}));

/**
 * AccountMatcher — import wizard step: map CSV account names to existing accounts.
 *
 * Similar to CategoryMatcher. Extracts unique account names from CSV data,
 * lets the user map each to an existing account or create a new one inline.
 *
 * Props:
 *  - mappedRows: object[] — rows from ColumnMapper (must have `csvAccount` field)
 *  - accounts: object[] — user's accounts from DB
 *  - onConfirm(accountMap): called with { csvAccountName: accountId } when confirmed
 *  - onBack(): return to previous step
 *  - onAccountCreated(account): callback when a new account is created inline
 */
export default function AccountMatcher({ mappedRows, accounts, onConfirm, onBack, onAccountCreated }) {
  // Extract unique CSV account names
  const csvAccountNames = useMemo(() => {
    const names = new Set();
    mappedRows.forEach((row) => {
      const name = String(row.csvAccount || '').trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort();
  }, [mappedRows]);

  // Auto-match: try case-insensitive exact match to existing accounts
  const autoMatches = useMemo(() => {
    const matches = {};
    csvAccountNames.forEach((csvName) => {
      const lower = csvName.toLowerCase();
      const match = accounts.find(
        (a) => a.name.toLowerCase() === lower
      );
      if (match) matches[csvName] = match.id;
    });
    return matches;
  }, [csvAccountNames, accounts]);

  // Manual overrides
  const [manualOverrides, setManualOverrides] = useState({});

  // Inline create state
  const [showCreateFor, setShowCreateFor] = useState(null); // csvName being created
  const [newAccountName, setNewAccountName] = useState('');
  const [newAccountType, setNewAccountType] = useState('checking');
  const [isCreating, setIsCreating] = useState(false);

  // Merged assignments
  const assignments = useMemo(() => {
    return { ...autoMatches, ...manualOverrides };
  }, [autoMatches, manualOverrides]);

  const matchedCount = csvAccountNames.filter((n) => assignments[n]).length;
  const unmatchedCount = csvAccountNames.length - matchedCount;

  function handleAccountChange(csvName, accountId) {
    setManualOverrides((prev) => ({
      ...prev,
      [csvName]: accountId || undefined,
    }));
  }

  async function handleCreateAccount(csvName) {
    const trimmed = newAccountName.trim();
    if (!trimmed) return;

    // Check if an account with this name already exists (case-insensitive)
    const existing = accounts.find(
      (a) => a.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      // Reuse the existing account instead of creating a duplicate
      setManualOverrides((prev) => ({ ...prev, [csvName]: existing.id }));
      setShowCreateFor(null);
      setNewAccountName('');
      setNewAccountType('checking');
      return;
    }

    setIsCreating(true);
    try {
      const created = await createAccount({
        name: trimmed,
        type: newAccountType,
        starting_balance: 0,
      });
      // Assign the new account to this CSV name
      setManualOverrides((prev) => ({ ...prev, [csvName]: created.id }));
      onAccountCreated?.(created);
      setShowCreateFor(null);
      setNewAccountName('');
      setNewAccountType('checking');
    } catch (err) {
      // Handle duplicate name constraint from DB as a graceful fallback
      if (err?.message?.includes('idx_accounts_user_name') || err?.message?.includes('duplicate key')) {
        alert(`An account named "${trimmed}" already exists. Please select it from the dropdown instead.`);
      } else {
        alert(err?.message || 'Failed to create account.');
      }
    } finally {
      setIsCreating(false);
    }
  }

  function handleConfirm() {
    onConfirm(assignments);
  }

  // Count rows per CSV account name
  const rowCountByName = useMemo(() => {
    const counts = {};
    mappedRows.forEach((row) => {
      const name = String(row.csvAccount || '').trim();
      if (name) counts[name] = (counts[name] || 0) + 1;
    });
    return counts;
  }, [mappedRows]);

  const canConfirm = unmatchedCount === 0;

  if (csvAccountNames.length === 0) {
    return (
      <div className="space-y-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
            No account names found in your CSV. Make sure you mapped the Account column in the previous step.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 rounded-xl bg-stone-50 px-4 py-2 dark:bg-stone-700/30">
          <span className="text-sm font-medium text-stone-600 dark:text-stone-400">Unique accounts:</span>
          <span className="text-sm font-bold text-stone-900 dark:text-stone-100">{csvAccountNames.length}</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2 dark:bg-emerald-900/30">
          <span className="text-sm font-medium text-emerald-700">Matched:</span>
          <span className="text-sm font-bold text-emerald-700">{matchedCount}</span>
        </div>
        {unmatchedCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2">
            <span className="text-sm font-medium text-amber-700">Unmatched:</span>
            <span className="text-sm font-bold text-amber-700">{unmatchedCount}</span>
          </div>
        )}
      </div>

      {/* Account mapping table */}
      <div className="overflow-x-auto rounded-xl border border-stone-200/60 dark:border-stone-700/60">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200/60 bg-stone-50 dark:border-stone-700/60 dark:bg-stone-700/30">
              <th className="px-4 py-3 text-left font-medium text-stone-600 dark:text-stone-400">CSV Account Name</th>
              <th className="px-4 py-3 text-left font-medium text-stone-600 dark:text-stone-400">Rows</th>
              <th className="px-4 py-3 text-left font-medium text-stone-600 dark:text-stone-400">Mapped To</th>
              <th className="px-4 py-3 text-right font-medium text-stone-600 dark:text-stone-400">Action</th>
            </tr>
          </thead>
          <tbody>
            {csvAccountNames.map((csvName) => {
              const assignedId = assignments[csvName];
              const isMatched = !!assignedId;
              const isCreatingThis = showCreateFor === csvName;

              return (
                <tr
                  key={csvName}
                  className={`border-b border-stone-100 dark:border-stone-700/60 ${isMatched ? '' : 'bg-amber-50/30 dark:bg-amber-900/10'}`}
                >
                  <td className="px-4 py-3 font-medium text-stone-900 dark:text-stone-100">{csvName}</td>
                  <td className="px-4 py-3 text-stone-500 dark:text-stone-400">{rowCountByName[csvName] || 0}</td>
                  <td className="px-4 py-3" colSpan={isCreatingThis ? 2 : 1}>
                    {isCreatingThis ? (
                      /* Inline create form — replaces dropdown + action column */
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={newAccountName}
                          onChange={(e) => setNewAccountName(e.target.value)}
                          placeholder="Account name"
                          autoFocus
                          className="min-w-[160px] flex-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100"
                        />
                        <select
                          value={newAccountType}
                          onChange={(e) => setNewAccountType(e.target.value)}
                          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100"
                        >
                          <optgroup label="Asset Accounts">
                            {ACCOUNT_TYPE_OPTIONS.filter((o) => o.group === 'asset').map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </optgroup>
                          <optgroup label="Liability Accounts">
                            {ACCOUNT_TYPE_OPTIONS.filter((o) => o.group === 'liability').map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </optgroup>
                        </select>
                        <button
                          type="button"
                          onClick={() => handleCreateAccount(csvName)}
                          disabled={isCreating || !newAccountName.trim()}
                          className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white transition-all hover:bg-amber-600 disabled:opacity-50"
                        >
                          {isCreating ? 'Creating…' : 'Create'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowCreateFor(null)}
                          className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm font-medium text-stone-600 transition-all hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      /* Normal dropdown */
                      <select
                        value={assignedId || ''}
                        onChange={(e) => handleAccountChange(csvName, e.target.value)}
                        className={`w-full rounded-lg border px-3 py-1.5 text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500 ${
                          isMatched
                            ? 'border-emerald-400 bg-white text-stone-900 dark:border-emerald-600 dark:bg-stone-800 dark:text-stone-100'
                            : 'border-amber-300 bg-white text-stone-900 dark:border-amber-700 dark:bg-stone-800 dark:text-stone-100'
                        }`}
                      >
                        <option value="">— Select account —</option>
                        {accounts.map((acct) => (
                          <option key={acct.id} value={acct.id}>
                            {maskAccountName(acct.name)} ({ACCOUNT_TYPES[acct.type]?.label || acct.type})
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  {!isCreatingThis && (
                    <td className="px-4 py-3 text-right">
                      {!isMatched && (
                        <button
                          type="button"
                          onClick={() => {
                            setShowCreateFor(csvName);
                            setNewAccountName(csvName);
                          }}
                          className="rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400 dark:hover:bg-amber-900/60"
                        >
                          + Create
                        </button>
                      )}
                      {isMatched && (
                        <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                          ✓
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

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
          {canConfirm
            ? 'Continue to Category Matching'
            : `${unmatchedCount} account${unmatchedCount !== 1 ? 's' : ''} still unmatched`}
        </button>
      </div>
    </div>
  );
}
