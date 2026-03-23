import { useEffect, useState } from 'react';
import { toCents, toDollars } from '../../utils/helpers';
import { ACCOUNT_TYPES, isAccountClosed } from '../../services/accounts';

const ACCOUNT_TYPE_GROUPS = [
  {
    label: 'Asset Accounts',
    types: ['checking', 'savings', 'retirement', 'brokerage'],
  },
  {
    label: 'Liability Accounts',
    types: ['credit_card', 'loan', 'mortgage'],
  },
];

/**
 * AccountForm — create, edit, close/reopen, or delete a financial account.
 *
 * Props:
 *  - accounts: array of existing account objects (for the selector)
 *  - onSubmit(values): called with { name, type, starting_balance, id? }
 *  - onDelete(id): called when an account is confirmed for deletion
 *  - onClose(id, closedAt): called when closing an account
 *  - onReopen(id): called when reopening a closed account
 *  - onCancel(): close form
 */
export default function AccountForm({ accounts = [], onSubmit, onDelete, onClose, onReopen, onCancel, favoriteAccountIds = [], onToggleFavorite }) {
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState('checking');
  const [startingBalance, setStartingBalance] = useState('');
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [closureDate, setClosureDate] = useState('');

  const isEditing = selectedId !== '';
  const selectedAccount = isEditing ? accounts.find((a) => a.id === selectedId) : null;
  const isClosed = isAccountClosed(selectedAccount);

  // Populate or clear form when account selection changes
  useEffect(() => {
    setErrors({});
    setSubmitError('');
    setShowDeleteConfirm(false);
    setShowCloseConfirm(false);
    setClosureDate('');
    if (!selectedId) {
      setName('');
      setType('checking');
      setStartingBalance('');
    } else {
      const acct = accounts.find((a) => a.id === selectedId);
      if (acct) {
        setName(acct.name || '');
        setType(acct.type || 'checking');
        setStartingBalance(String(toDollars(acct.starting_balance || 0)));
      }
    }
  }, [selectedId, accounts]);

  function validate() {
    const errs = {};
    if (!name.trim()) errs.name = 'Account name is required.';
    if (!type) errs.type = 'Please select an account type.';
    const numBalance = parseFloat(startingBalance);
    if (startingBalance && isNaN(numBalance)) errs.startingBalance = 'Starting balance must be a number.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    setIsSaving(true);
    try {
      await onSubmit({
        ...(isEditing ? { id: selectedId } : {}),
        name: name.trim(),
        type,
        starting_balance: toCents(parseFloat(startingBalance) || 0),
      });
    } catch (err) {
      setSubmitError(err?.message || 'Failed to save account.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await onDelete(selectedId);
    } catch (err) {
      setSubmitError(err?.message || 'Failed to delete account.');
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  }

  async function handleClose() {
    const dateVal = closureDate || new Date().toISOString().slice(0, 10);
    setIsClosing(true);
    try {
      await onClose(selectedId, dateVal);
    } catch (err) {
      setSubmitError(err?.message || 'Failed to close account.');
      setIsClosing(false);
      setShowCloseConfirm(false);
    }
  }

  async function handleReopen() {
    setIsClosing(true);
    try {
      await onReopen(selectedId);
    } catch (err) {
      setSubmitError(err?.message || 'Failed to reopen account.');
      setIsClosing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Account selector */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Account</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
        >
          <option value="">── New Account ──</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}{isAccountClosed(a) ? ' (Closed)' : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="border-t border-stone-100 dark:border-stone-700" />

      {submitError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            <span className="mr-1.5">⚠</span>{submitError}
          </p>
        </div>
      )}

      {/* Account Name */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Account Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
          placeholder="e.g., Chase Checking, Amex Gold"
        />
        {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
      </div>

      {/* Account Type */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Account Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
        >
          {ACCOUNT_TYPE_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.types.map((t) => (
                <option key={t} value={t}>
                  {ACCOUNT_TYPES[t].label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {errors.type && <p className="text-xs text-red-500">{errors.type}</p>}
      </div>

      {/* Starting Balance */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Starting Balance (dollars)</label>
        <input
          type="number"
          step="0.01"
          value={startingBalance}
          onChange={(e) => setStartingBalance(e.target.value)}
          className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
          placeholder="0.00"
        />
        <p className="text-xs text-stone-400 dark:text-stone-500">
          {ACCOUNT_TYPES[type]?.group === 'liability'
            ? 'Enter the current balance owed (positive number).'
            : 'Enter your opening balance before any tracked transactions.'}
        </p>
        {errors.startingBalance && <p className="text-xs text-red-500">{errors.startingBalance}</p>}
      </div>

      {/* Favorite toggle — only shown when editing an existing account */}
      {isEditing && onToggleFavorite && (
        <div className="border-t border-stone-100 pt-4 dark:border-stone-700">
          <button
            type="button"
            onClick={() => onToggleFavorite(selectedId)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-6 py-2 text-sm font-medium text-amber-700 transition-all hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
          >
            {favoriteAccountIds.includes(selectedId) ? (
              <>
                <span aria-hidden="true">★</span>
                Remove from Favorites
              </>
            ) : (
              <>
                <span aria-hidden="true">☆</span>
                Add to Favorites
              </>
            )}
          </button>
        </div>
      )}

      {/* Primary actions */}
      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none dark:shadow-amber-900/30 dark:hover:shadow-amber-900/30"
        >
          {isSaving ? 'Saving…' : isEditing ? 'Update Account' : 'Add Account'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-stone-200 bg-white px-6 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Cancel
        </button>
      </div>

      {/* Closed account banner */}
      {isEditing && isClosed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            This account was closed on {selectedAccount.closed_at}.
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            Closed accounts are hidden from transaction forms and recurring templates are paused.
          </p>
        </div>
      )}

      {/* Close / Reopen section — only for existing accounts */}
      {isEditing && (
        <div className="border-t border-stone-100 pt-4 dark:border-stone-700">
          {isClosed ? (
            <button
              type="button"
              onClick={handleReopen}
              disabled={isClosing}
              className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-2 text-sm font-medium text-emerald-700 transition-all hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400 dark:hover:bg-emerald-900"
            >
              {isClosing ? 'Reopening…' : 'Reopen Account'}
            </button>
          ) : !showCloseConfirm ? (
            <button
              type="button"
              onClick={() => {
                setClosureDate(new Date().toISOString().slice(0, 10));
                setShowCloseConfirm(true);
              }}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 px-6 py-2 text-sm font-medium text-amber-700 transition-all hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
            >
              Close Account
            </button>
          ) : (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
              <p className="mb-2 text-sm text-amber-800 dark:text-amber-300">
                Closing this account will hide it from transaction forms and pause any linked recurring templates.
              </p>
              <div className="mb-3 space-y-1.5">
                <label className="block text-xs font-medium text-amber-700 dark:text-amber-400">Closure date</label>
                <input
                  type="date"
                  value={closureDate}
                  onChange={(e) => setClosureDate(e.target.value)}
                  className="w-full rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-amber-700 dark:bg-stone-800 dark:text-stone-100"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isClosing}
                  className="flex-1 rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition-all hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isClosing ? 'Closing…' : 'Confirm Close'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCloseConfirm(false)}
                  className="flex-1 rounded-lg border border-stone-200 bg-white px-4 py-1.5 text-sm font-medium text-stone-600 transition-all hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Delete section — only shown when editing an existing account */}
      {isEditing && (
        <div className="border-t border-stone-100 pt-4 dark:border-stone-700">
          {!showDeleteConfirm ? (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full rounded-xl border border-red-200 bg-red-50 px-6 py-2 text-sm font-medium text-red-600 transition-all hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:border-red-800 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
            >
              Delete Account
            </button>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
              <p className="mb-3 text-sm text-red-700 dark:text-red-400">
                Delete this account? It will be deactivated. Linked transactions will not be deleted.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="flex-1 rounded-lg bg-red-500 px-4 py-1.5 text-sm font-semibold text-white transition-all hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting…' : 'Confirm Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1 rounded-lg border border-stone-200 bg-white px-4 py-1.5 text-sm font-medium text-stone-600 transition-all hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}
