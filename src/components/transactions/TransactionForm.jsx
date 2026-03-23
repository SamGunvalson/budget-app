import { useEffect, useState } from 'react';
import { toCents, toDollars, CATEGORY_TYPE_ORDER, CATEGORY_TYPE_LABELS, maskAccountName } from '../../utils/helpers';
import { ACCOUNT_TYPES, isAssetAccount } from '../../services/accounts';

/**
 * TransactionForm — add or edit a transaction.
 *
 * Props:
 *  - categories: Array of category objects (for dropdown)
 *  - accounts: Array of account objects (for dropdown)
 *  - initialValues: optional transaction object when editing
 *  - onSubmit(values): called with { account_id, category_id, amount, description, payee, transaction_date, is_income }
 *  - onSubmitTransfer(values): called with { from_account_id, to_account_id, amount, description, transaction_date, category_id }
 *  - onSubmitLinkedTransfer(values): called with { account_id, linked_account_id, category_id, amount, description, payee, transaction_date, is_income }
 *  - onSubmitAdjustment(values): called with { account_id, category_id, amount, description, payee, transaction_date, is_income } — single-account balance adjustment
 *  - onCancel(): close form
 *  - isEditing: boolean flag
 *  - defaultAccountId: optional pre-selected account
 *  - linkedAccountId: pre-resolved linked account ID when editing a linked transfer
 */
export default function TransactionForm({ categories = [], accounts = [], initialValues, onSubmit, onSubmitTransfer, onSubmitLinkedTransfer, onSubmitAdjustment, onCancel, isEditing = false, defaultAccountId, transferCompanionAccountId, linkedAccountId: initialLinkedAccountId, partnership, hasSplit }) {
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [payee, setPayee] = useState('');
  const [transactionDate, setTransactionDate] = useState('');
  const [transactionType, setTransactionType] = useState('expense'); // 'expense' | 'income' | 'transfer'
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Transfer fields
  const [toAccountId, setToAccountId] = useState('');
  const [gainOrLoss, setGainOrLoss] = useState('gain'); // 'gain' | 'loss' — used for single-account adjustments

  // Linked account — optional companion for expense/income transactions
  const [linkedAccountId, setLinkedAccountId] = useState('');

  // Planned/future transaction toggle
  const [isPlanned, setIsPlanned] = useState(false);

  // Split with partner toggle
  const [isSplit, setIsSplit] = useState(false);

  // Derived flags
  const isTransfer = transactionType === 'transfer';
  const isIncome = transactionType === 'income';
  const isAdjustment = isTransfer && !toAccountId; // single-account balance adjustment

  // Filter categories based on transaction type
  const filteredCategories = isTransfer
    ? categories.filter((c) => c.type === 'transfer')
    : categories.filter((c) => c.type !== 'transfer');

  // Group filtered categories by type for <optgroup>
  const groupedCategories = CATEGORY_TYPE_ORDER
    .map((type) => ({
      type,
      label: CATEGORY_TYPE_LABELS[type],
      items: filteredCategories.filter((c) => c.type === type),
    }))
    .filter((g) => g.items.length > 0);

  // Populate form when editing
  useEffect(() => {
    if (initialValues) {
      setCategoryId(initialValues.category_id || '');
      setAmount(String(toDollars(Math.abs(initialValues.amount))));
      setDescription(initialValues.description || '');
      setPayee(initialValues.payee || '');
      setTransactionDate(initialValues.transaction_date || '');

      // Set planned status from transaction status
      const txStatus = initialValues.status || 'posted';
      if (txStatus === 'pending' || txStatus === 'projected') {
        setIsPlanned(true);
      }

      // Derive transaction type from existing data
      if (initialValues.categories?.type === 'transfer') {
        setTransactionType('transfer');
        // Orient from/to correctly for transfer editing
        if (transferCompanionAccountId) {
          if (initialValues.is_income) {
            // User clicked the "to" leg — companion is the "from" account
            setAccountId(transferCompanionAccountId);
            setToAccountId(initialValues.account_id || '');
          } else {
            // User clicked the "from" leg
            setAccountId(initialValues.account_id || '');
            setToAccountId(transferCompanionAccountId);
          }
        } else {
          setAccountId(initialValues.account_id || '');
          // No companion — this is a single-account adjustment; restore gain/loss direction
          setGainOrLoss(initialValues.is_income ? 'gain' : 'loss');
        }
      } else {
        setAccountId(initialValues.account_id || '');
        setTransactionType(initialValues.is_income ? 'income' : 'expense');
        // Populate linked account if editing a linked transfer
        if (initialLinkedAccountId) {
          setLinkedAccountId(initialLinkedAccountId);
        }
        setIsSplit(hasSplit ?? false);
      }
    }
  }, [initialValues, transferCompanionAccountId, initialLinkedAccountId, hasSplit]);

  // Set default account
  useEffect(() => {
    if (!isEditing && !accountId && defaultAccountId) {
      setAccountId(defaultAccountId);
    }
  }, [isEditing, accountId, defaultAccountId]);

  // Default date to today for new transactions
  useEffect(() => {
    if (!isEditing && !transactionDate) {
      setTransactionDate(new Date().toISOString().split('T')[0]);
    }
  }, [isEditing, transactionDate]);

  // When switching transaction type (new transactions only), auto-select first matching category
  useEffect(() => {
    if (isEditing) return;
    const matching = isTransfer
      ? categories.filter((c) => c.type === 'transfer')
      : categories.filter((c) => c.type !== 'transfer');
    const firstMatch = matching[0];
    if (firstMatch) {
      setCategoryId(firstMatch.id);
      if (isTransfer) {
        setPayee(firstMatch.name);
      }
    } else {
      setCategoryId('');
    }
    // Clear toAccountId when leaving transfer mode
    if (!isTransfer) {
      setToAccountId('');
    }
    // Clear linked account and split when entering transfer mode
    if (isTransfer) {
      setLinkedAccountId('');
      setIsSplit(false);
    }
  }, [transactionType]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fill payee when transfer category changes (new transactions only)
  useEffect(() => {
    if (!isTransfer || isEditing) return;
    const cat = categories.find((c) => c.id === categoryId);
    if (cat) {
      setPayee(cat.name);
    }
  }, [categoryId, isTransfer]); // eslint-disable-line react-hooks/exhaustive-deps

  function validate() {
    const errs = {};
    if (!accountId) errs.accountId = 'Please select an account.';
    if (!categoryId) errs.categoryId = 'Please select a category.';
    const numAmount = parseFloat(amount);
    if (!amount || isNaN(numAmount) || numAmount <= 0) errs.amount = 'Amount must be greater than 0.';
    if (!payee.trim()) errs.payee = 'Payee is required.';
    if (!transactionDate) errs.transactionDate = 'Date is required.';
    if (isTransfer && !isAdjustment && !toAccountId) errs.toAccountId = 'Please select a destination account.';
    if (isTransfer && !isAdjustment && toAccountId === accountId) errs.toAccountId = 'Destination must be different from source.';
    if (!isTransfer && linkedAccountId && linkedAccountId === accountId) errs.linkedAccountId = 'Linked account must be different from the main account.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    setIsSaving(true);
    try {
      const statusValue = isPlanned ? 'pending' : undefined;

      if (isTransfer && isAdjustment && onSubmitAdjustment) {
        await onSubmitAdjustment({
          account_id: accountId,
          category_id: categoryId,
          amount: toCents(parseFloat(amount)),
          description,
          payee,
          transaction_date: transactionDate,
          is_income: gainOrLoss === 'gain',
          ...(statusValue && { status: statusValue }),
        });
      } else if (isTransfer && onSubmitTransfer) {
        await onSubmitTransfer({
          from_account_id: accountId,
          to_account_id: toAccountId,
          amount: toCents(parseFloat(amount)),
          description,
          payee,
          transaction_date: transactionDate,
          category_id: categoryId,
          ...(statusValue && { status: statusValue }),
        });
      } else if (!isTransfer && linkedAccountId && onSubmitLinkedTransfer) {
        await onSubmitLinkedTransfer({
          account_id: accountId,
          linked_account_id: linkedAccountId,
          category_id: categoryId,
          amount: toCents(parseFloat(amount)),
          description,
          payee,
          transaction_date: transactionDate,
          is_income: isIncome,
          isSplit,
          ...(statusValue && { status: statusValue }),
        });
      } else {
        await onSubmit({
          account_id: accountId,
          category_id: categoryId,
          amount: toCents(parseFloat(amount)),
          description,
          payee,
          transaction_date: transactionDate,
          is_income: isIncome,
          isSplit,
          ...(statusValue && { status: statusValue }),
        });
      }
    } catch (err) {
      setSubmitError(err?.message || 'Failed to save transaction.');
    } finally {
      setIsSaving(false);
    }
  }

  // Group accounts for dropdown — exclude closed accounts unless already selected (editing)
  const openAccounts = accounts.filter((a) => !a.closed_at || a.id === accountId || a.id === toAccountId || a.id === linkedAccountId);
  const assetAccounts = openAccounts.filter((a) => isAssetAccount(a.type));
  const liabilityAccounts = openAccounts.filter((a) => !isAssetAccount(a.type));
  const acctLabel = (a) => maskAccountName(a.name) + (a.closed_at ? ' (Closed)' : '');

  function InfoTip({ text }) {
    return (
      <span className="group/tip relative ml-1 inline-flex">
        <button
          type="button"
          tabIndex={-1}
          aria-label="More info"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-stone-200 text-[10px] font-bold text-stone-500 hover:bg-stone-300 dark:bg-stone-700 dark:text-stone-400 dark:hover:bg-stone-600"
        >
          ?
        </button>
        <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-52 -translate-x-1/2 rounded-lg bg-stone-800 px-2.5 py-1.5 text-xs leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover/tip:opacity-100 dark:bg-stone-900">
          {text}
          <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-stone-800 dark:border-t-stone-900" />
        </span>
      </span>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {submitError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
          <p className="text-sm font-medium text-red-700 dark:text-red-400">
            <span className="mr-1.5">⚠</span>{submitError}
          </p>
        </div>
      )}

      {/* Transaction type toggle — segmented control */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Type</label>
          {isTransfer && (
            <InfoTip text={isAdjustment ? "Balance adjustments don't affect income or expense totals." : "Transfers don't affect income or expense totals."} />
          )}
        </div>
        <div className="flex overflow-hidden rounded-xl border border-stone-200 dark:border-stone-700">
          <button
            type="button"
            onClick={() => !(isEditing && isTransfer) && setTransactionType('expense')}
            disabled={isEditing && isTransfer}
            className={`flex-1 border-r border-stone-200 px-4 py-2.5 text-sm font-semibold transition-colors dark:border-stone-700 ${
              transactionType === 'expense'
                ? 'bg-red-500 text-white'
                : 'bg-white text-stone-600 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
            } ${isEditing && isTransfer ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => !(isEditing && isTransfer) && setTransactionType('income')}
            disabled={isEditing && isTransfer}
            className={`flex-1 border-r border-stone-200 px-4 py-2.5 text-sm font-semibold transition-colors dark:border-stone-700 ${
              transactionType === 'income'
                ? 'bg-emerald-500 text-white'
                : 'bg-white text-stone-600 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
            } ${isEditing && isTransfer ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            Income
          </button>
          <button
            type="button"
            onClick={() => !isEditing && setTransactionType('transfer')}
            disabled={isEditing}
            className={`flex-1 px-4 py-2.5 text-sm font-semibold transition-colors ${
              transactionType === 'transfer'
                ? 'bg-blue-500 text-white'
                : 'bg-white text-stone-600 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
            } ${isEditing ? 'cursor-not-allowed opacity-60' : ''}`}
          >
            Transfer
          </button>
        </div>
      </div>

      {/* Account fields — 2-col grid per transaction type */}
      {!isTransfer ? (
        <div className="grid grid-cols-2 gap-3">
          {/* Account */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Account</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2.5 text-sm text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
            >
              <option value="">Account…</option>
              {assetAccounts.length > 0 && (
                <optgroup label="Assets">
                  {assetAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{acctLabel(a)}</option>
                  ))}
                </optgroup>
              )}
              {liabilityAccounts.length > 0 && (
                <optgroup label="Liabilities">
                  {liabilityAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{acctLabel(a)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {errors.accountId && <p className="text-xs text-red-500">{errors.accountId}</p>}
          </div>
          {/* Linked Account */}
          <div className="space-y-1.5">
            <label className="flex items-center text-sm font-medium text-stone-700 dark:text-stone-300">
              Linked
              <InfoTip text="Creates a neutral companion transaction on the linked account (won't affect budget totals)." />
            </label>
            <select
              value={linkedAccountId}
              onChange={(e) => setLinkedAccountId(e.target.value)}
              className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2.5 text-sm text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
            >
              <option value="">None</option>
              {assetAccounts.filter((a) => a.id !== accountId).length > 0 && (
                <optgroup label="Assets">
                  {assetAccounts.filter((a) => a.id !== accountId).map((a) => (
                    <option key={a.id} value={a.id}>{acctLabel(a)}</option>
                  ))}
                </optgroup>
              )}
              {liabilityAccounts.filter((a) => a.id !== accountId).length > 0 && (
                <optgroup label="Liabilities">
                  {liabilityAccounts.filter((a) => a.id !== accountId).map((a) => (
                    <option key={a.id} value={a.id}>{acctLabel(a)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {errors.linkedAccountId && <p className="text-xs text-red-500">{errors.linkedAccountId}</p>}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {/* From Account */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">From</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2.5 text-sm text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
            >
              <option value="">Account…</option>
              {assetAccounts.length > 0 && (
                <optgroup label="Assets">
                  {assetAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{acctLabel(a)}</option>
                  ))}
                </optgroup>
              )}
              {liabilityAccounts.length > 0 && (
                <optgroup label="Liabilities">
                  {liabilityAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{acctLabel(a)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {errors.accountId && <p className="text-xs text-red-500">{errors.accountId}</p>}
          </div>
          {/* To Account */}
          <div className="space-y-1.5">
            <label className="flex items-center text-sm font-medium text-stone-700 dark:text-stone-300">
              To
              <InfoTip text="Leave blank to record a single-account balance adjustment (e.g. market gain/loss)." />
            </label>
            <select
              value={toAccountId}
              onChange={(e) => setToAccountId(e.target.value)}
              className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2.5 text-sm text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
            >
              <option value="">None (adjustment)</option>
              {assetAccounts.filter((a) => a.id !== accountId).length > 0 && (
                <optgroup label="Assets">
                  {assetAccounts.filter((a) => a.id !== accountId).map((a) => (
                    <option key={a.id} value={a.id}>{acctLabel(a)}</option>
                  ))}
                </optgroup>
              )}
              {liabilityAccounts.filter((a) => a.id !== accountId).length > 0 && (
                <optgroup label="Liabilities">
                  {liabilityAccounts.filter((a) => a.id !== accountId).map((a) => (
                    <option key={a.id} value={a.id}>{acctLabel(a)}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {errors.toAccountId && <p className="text-xs text-red-500">{errors.toAccountId}</p>}
          </div>
        </div>
      )}

      {/* Gain / Loss toggle — shown when transfer has no destination account */}
      {isAdjustment && (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Direction</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setGainOrLoss('gain')}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                gainOrLoss === 'gain'
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200/50 dark:shadow-emerald-900/30'
                  : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
              }`}
            >
              Gain
            </button>
            <button
              type="button"
              onClick={() => setGainOrLoss('loss')}
              className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                gainOrLoss === 'loss'
                  ? 'bg-red-500 text-white shadow-md shadow-red-200/50 dark:shadow-red-900/30'
                  : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
              }`}
            >
              Loss
            </button>
          </div>
        </div>
      )}

      {/* Category + Amount — 2-col grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2.5 text-sm text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
          >
            <option value="">Category…</option>
            {groupedCategories.map((group) => (
              <optgroup key={group.type} label={group.label}>
                {group.items.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.categoryId && <p className="text-xs text-red-500">{errors.categoryId}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Amount ($)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-3 py-2.5 text-sm text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
            placeholder="0.00"
          />
          {errors.amount && <p className="text-xs text-red-500">{errors.amount}</p>}
        </div>
      </div>

      {/* Payee */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Payee</label>
        <input
          type="text"
          value={payee}
          onChange={(e) => setPayee(e.target.value)}
          className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
          placeholder="Who is this to/from?"
        />
        {errors.payee && <p className="text-xs text-red-500">{errors.payee}</p>}
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">
          Description <span className="text-stone-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
          placeholder="What is this for? (optional)"
        />
      </div>

      {/* Date */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-stone-700 dark:text-stone-300">Date</label>
        <input
          type="date"
          value={transactionDate}
          onChange={(e) => setTransactionDate(e.target.value)}
          className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
        />
        {errors.transactionDate && <p className="text-xs text-red-500">{errors.transactionDate}</p>}
      </div>

      {/* Planned / Split toggles — side by side */}
      <div className="flex gap-6">
        {/* Planned/Future toggle */}
        <div className="flex items-center gap-2.5">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={isPlanned}
              onChange={(e) => setIsPlanned(e.target.checked)}
              className="peer sr-only"
            />
            <div className="peer h-5 w-9 rounded-full bg-stone-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-violet-500 peer-checked:after:translate-x-full peer-focus:ring-2 peer-focus:ring-violet-500 dark:bg-stone-600 dark:peer-checked:bg-violet-500" />
          </label>
          <span className="flex items-center text-sm font-medium text-stone-700 dark:text-stone-300">
            Planned
            <InfoTip text="Mark as pending — won't affect actual balances until confirmed." />
          </span>
        </div>

        {/* Split with partner toggle */}
        {partnership && !isTransfer && (
          <div className="flex items-center gap-2.5">
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={isSplit}
                onChange={(e) => setIsSplit(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-stone-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-pink-500 peer-checked:after:translate-x-full peer-focus:ring-2 peer-focus:ring-pink-500 dark:bg-stone-600 dark:peer-checked:bg-pink-500" />
            </label>
            <span className="flex items-center text-sm font-medium text-stone-700 dark:text-stone-300">
              Split
              <InfoTip text="After saving, you'll be prompted to set up the split details with your partner." />
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-4">
        <button
          type="submit"
          disabled={isSaving}
          className="flex-1 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none dark:shadow-amber-900/30 dark:hover:shadow-amber-900/30"
        >
          {isSaving ? 'Saving…' : isEditing ? 'Update Transaction' : 'Add Transaction'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-stone-200 bg-white px-6 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
