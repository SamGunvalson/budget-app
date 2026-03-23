import { useEffect, useState } from 'react';
import { toCents, toDollars, CATEGORY_TYPE_ORDER, CATEGORY_TYPE_LABELS, maskAccountName } from '../../utils/helpers';
import { ACCOUNT_TYPES } from '../../services/accounts';
import { FREQUENCY_OPTIONS, DAY_OF_WEEK_LABELS } from '../../utils/recurringCalculations';

/**
 * RecurringForm — create or edit a recurring transaction template.
 * Supports expense, income, and transfer types, plus semi-monthly frequency.
 *
 * Props:
 *  - categories: Array of category objects
 *  - accounts: Array of account objects
 *  - initialValues: optional template object when editing
 *  - onSubmit(values): called with template fields (amount already in cents)
 *  - onCancel(): close form
 *  - isEditing: boolean flag
 */
export default function RecurringForm({
  categories = [],
  accounts = [],
  initialValues,
  onSubmit,
  onCancel,
  isEditing = false,
}) {
  // 'expense' | 'income' | 'transfer'
  const [txType, setTxType] = useState('expense');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [linkedAccountId, setLinkedAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [payee, setPayee] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [dayOfMonth2, setDayOfMonth2] = useState('15');
  const [dayOfWeek, setDayOfWeek] = useState('0');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [autoConfirm, setAutoConfirm] = useState(true);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(!isEditing);

  // Derive isIncome and isTransfer from txType
  const isIncome = txType === 'income';
  const isTransfer = txType === 'transfer';

  // Filter categories based on type
  const filteredCategories = isTransfer
    ? categories.filter((c) => c.type === 'transfer')
    : categories.filter((c) => c.type !== 'transfer');

  // Group filtered categories by type
  const groupedCategories = CATEGORY_TYPE_ORDER
    .map((type) => ({
      type,
      label: CATEGORY_TYPE_LABELS[type],
      items: filteredCategories.filter((c) => c.type === type),
    }))
    .filter((g) => g.items.length > 0);

  // Group accounts by type — exclude closed accounts unless already selected (editing)
  const openAccounts = accounts.filter((a) => !a.closed_at || a.id === accountId || a.id === toAccountId || a.id === linkedAccountId);
  const groupedAccounts = Object.entries(
    openAccounts.reduce((acc, a) => {
      const label = (ACCOUNT_TYPES[a.type]?.label || a.type) + (a.closed_at ? ' (Closed)' : '');
      if (!acc[label]) acc[label] = [];
      acc[label].push(a);
      return acc;
    }, {}),
  );

  // Whether we need day_of_month, day_of_month_2, or day_of_week
  const needsDayOfMonth = ['monthly', 'semi_monthly', 'quarterly', 'yearly'].includes(frequency);
  const needsDayOfMonth2 = frequency === 'semi_monthly';
  const needsDayOfWeek = ['weekly', 'biweekly'].includes(frequency);

  // Populate form when editing
  useEffect(() => {
    if (initialValues) {
      // Determine type from flags
      if (initialValues.is_transfer) {
        setTxType('transfer');
      } else if (initialValues.is_income) {
        setTxType('income');
      } else {
        setTxType('expense');
      }
      setAccountId(initialValues.account_id || '');
      setToAccountId(initialValues.to_account_id || '');
      // Populate linked account for non-transfer templates that have to_account_id
      if (!initialValues.is_transfer && initialValues.to_account_id) {
        setLinkedAccountId(initialValues.to_account_id || '');
      }
      setCategoryId(initialValues.category_id || '');
      setAmount(String(toDollars(Math.abs(initialValues.amount))));
      setDescription(initialValues.description || '');
      setPayee(initialValues.payee || '');
      setFrequency(initialValues.frequency || 'monthly');
      setDayOfMonth(String(initialValues.day_of_month || 1));
      setDayOfMonth2(String(initialValues.day_of_month_2 || 15));
      setDayOfWeek(String(initialValues.day_of_week ?? 0));
      setStartDate(initialValues.start_date || '');
      setEndDate(initialValues.end_date || '');
      if (initialValues.auto_confirm !== undefined) setAutoConfirm(initialValues.auto_confirm);
    }
  }, [initialValues]);

  // Default start date to today for new templates
  useEffect(() => {
    if (!isEditing && !startDate) {
      setStartDate(new Date().toISOString().split('T')[0]);
    }
  }, [isEditing, startDate]);

  // Auto-select first category if none selected (or when type changes)
  useEffect(() => {
    if (filteredCategories.length > 0) {
      const currentValid = filteredCategories.some((c) => c.id === categoryId);
      if (!currentValid) {
        setCategoryId(filteredCategories[0].id);
      }
    } else {
      // No categories available for this type — clear stale selection
      setCategoryId('');
    }
  }, [txType, filteredCategories, categoryId]);

  const validate = () => {
    const errs = {};
    if (!accountId) errs.accountId = 'Account is required';
    if (isTransfer && !toAccountId) errs.toAccountId = 'Destination account is required';
    if (isTransfer && toAccountId === accountId) errs.toAccountId = 'From and To accounts must be different';
    if (!isTransfer && linkedAccountId && linkedAccountId === accountId) errs.linkedAccountId = 'Linked account must be different from the main account';
    if (!categoryId) errs.categoryId = 'Category is required';
    if (!description.trim()) errs.description = 'Description is required';
    const amtNum = parseFloat(amount);
    if (!amount || isNaN(amtNum) || amtNum <= 0) errs.amount = 'Enter a positive amount';
    if (!startDate) errs.startDate = 'Start date is required';
    if (endDate && endDate < startDate) errs.endDate = 'End date must be after start date';
    if (needsDayOfMonth) {
      const d = parseInt(dayOfMonth, 10);
      if (isNaN(d) || d < 1 || d > 31) errs.dayOfMonth = 'Day must be 1–31';
    }
    if (needsDayOfMonth2) {
      const d2 = parseInt(dayOfMonth2, 10);
      if (isNaN(d2) || d2 < 1 || d2 > 31) errs.dayOfMonth2 = 'Second day must be 1–31';
      if (!errs.dayOfMonth && !errs.dayOfMonth2 && parseInt(dayOfMonth, 10) === d2) {
        errs.dayOfMonth2 = 'Days must be different';
      }
    }
    setErrors(errs);
    const hasScheduleErrors = ['startDate', 'endDate', 'dayOfMonth', 'dayOfMonth2'].some((k) => errs[k]);
    if (hasScheduleErrors) setScheduleOpen(true);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSaving(true);
    setSubmitError('');

    const amountCents = toCents(parseFloat(amount));

    try {
      await onSubmit({
        account_id: accountId,
        category_id: categoryId,
        description: description.trim(),
        payee: payee.trim() || null,
        amount: Math.abs(amountCents),
        is_income: isIncome,
        is_transfer: isTransfer,
        to_account_id: isTransfer ? toAccountId : (linkedAccountId || null),
        frequency,
        day_of_month: needsDayOfMonth ? parseInt(dayOfMonth, 10) : null,
        day_of_month_2: needsDayOfMonth2 ? parseInt(dayOfMonth2, 10) : null,
        day_of_week: needsDayOfWeek ? parseInt(dayOfWeek, 10) : null,
        start_date: startDate,
        end_date: endDate || null,
        auto_confirm: autoConfirm,
      });
    } catch (err) {
      setSubmitError(err?.message || 'Failed to save recurring template');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-stone-200 bg-white px-4 py-1.5 sm:py-2.5 text-sm text-stone-900 shadow-sm transition-all focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100';
  const labelClass = 'mb-1 sm:mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300';
  const errorClass = 'mt-1 text-xs text-red-500';

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {submitError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {submitError}
        </div>
      )}

      {/* Expense / Income / Transfer toggle */}
      <div>
        <label className={labelClass}>Type</label>
        <div className="inline-flex rounded-xl border border-stone-200/60 bg-white p-1 shadow-sm dark:border-stone-700/60 dark:bg-stone-800">
          <button
            type="button"
            onClick={() => setTxType('expense')}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
              txType === 'expense'
                ? 'bg-amber-500 text-white shadow-md shadow-amber-200/50'
                : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-700'
            }`}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => setTxType('income')}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
              txType === 'income'
                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-200/50'
                : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-700'
            }`}
          >
            Income
          </button>
          <button
            type="button"
            onClick={() => setTxType('transfer')}
            className={`rounded-lg px-4 py-1.5 text-sm font-medium transition-all ${
              txType === 'transfer'
                ? 'bg-blue-500 text-white shadow-md shadow-blue-200/50'
                : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-700'
            }`}
          >
            Transfer
          </button>
        </div>
      </div>

      {/* Description + Payee */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Description *</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={isTransfer ? 'e.g., Credit Card Payment, Savings Transfer' : 'e.g., Rent, Netflix, Salary'}
            className={inputClass}
          />
          {errors.description && <p className={errorClass}>{errors.description}</p>}
        </div>
        <div>
          <label className={labelClass}>Payee</label>
          <input
            type="text"
            value={payee}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="e.g., Landlord"
            className={inputClass}
          />
        </div>
      </div>

      {/* Amount + Category */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Amount ($) *</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={inputClass}
          />
          {errors.amount && <p className={errorClass}>{errors.amount}</p>}
        </div>
        <div>
          <label className={labelClass}>Category *</label>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
            <option value="">Select…</option>
            {groupedCategories.map((g) => (
              <optgroup key={g.type} label={g.label}>
                {g.items.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.categoryId && <p className={errorClass}>{errors.categoryId}</p>}
        </div>
      </div>

      {/* Account(s) */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>{isTransfer ? 'From *' : 'Account *'}</label>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
            <option value="">Account…</option>
            {groupedAccounts.map(([group, accts]) => (
              <optgroup key={group} label={group}>
                {accts.map((a) => (
                  <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.accountId && <p className={errorClass}>{errors.accountId}</p>}
        </div>
        <div>
          {isTransfer ? (
            <>
              <label className={labelClass}>To *</label>
              <select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)} className={inputClass}>
                <option value="">Account…</option>
                {groupedAccounts.map(([group, accts]) => (
                  <optgroup key={group} label={group}>
                    {accts.map((a) => (
                      <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {errors.toAccountId && <p className={errorClass}>{errors.toAccountId}</p>}
            </>
          ) : (
            <>
              <label className={labelClass}>
                Linked
                <span className="group relative ml-1 inline-flex cursor-default">
                  <svg className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                  </svg>
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-56 -translate-x-1/2 rounded-lg bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-stone-700">
                    Creates a neutral companion on the linked account — won't affect budget totals.
                  </span>
                </span>
              </label>
              <select value={linkedAccountId} onChange={(e) => setLinkedAccountId(e.target.value)} className={inputClass}>
                <option value="">None</option>
                {groupedAccounts.map(([group, accts]) => (
                  <optgroup key={group} label={group}>
                    {accts.filter((a) => a.id !== accountId).map((a) => (
                      <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {errors.linkedAccountId && <p className={errorClass}>{errors.linkedAccountId}</p>}
            </>
          )}
        </div>
      </div>

      {/* Schedule section (collapsible) */}
      <div className="rounded-xl border border-stone-200/60 bg-stone-50/50 p-4 dark:border-stone-700/40 dark:bg-stone-800/50">
        <button
          type="button"
          onClick={() => setScheduleOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-lg text-left"
        >
          <span className="text-sm font-semibold text-stone-800 dark:text-stone-200">Schedule</span>
          <span className="flex items-center gap-2">
            {!scheduleOpen && (
              <span className="text-xs font-normal text-amber-600 dark:text-amber-400">
                {FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.label}
                {needsDayOfMonth && ` · Day ${dayOfMonth}`}
                {needsDayOfWeek && ` · ${DAY_OF_WEEK_LABELS[parseInt(dayOfWeek, 10)]}`}
              </span>
            )}
            <svg
              className={`h-4 w-4 shrink-0 text-stone-400 transition-transform dark:text-stone-500 ${scheduleOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </button>

        {scheduleOpen && (<>
          {/* Frequency + Day selectors */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Frequency *</label>
              <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputClass}>
                {FREQUENCY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {needsDayOfMonth && (
              <div>
                <label className={labelClass}>{needsDayOfMonth2 ? 'First Day *' : 'Day of Month *'}</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={dayOfMonth}
                  onChange={(e) => setDayOfMonth(e.target.value)}
                  className={inputClass}
                />
                {errors.dayOfMonth && <p className={errorClass}>{errors.dayOfMonth}</p>}
              </div>
            )}

            {needsDayOfMonth2 && (
              <div>
                <label className={labelClass}>Second Day *</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={dayOfMonth2}
                  onChange={(e) => setDayOfMonth2(e.target.value)}
                  className={inputClass}
                />
                {errors.dayOfMonth2 && <p className={errorClass}>{errors.dayOfMonth2}</p>}
              </div>
            )}

            {needsDayOfWeek && (
              <div>
                <label className={labelClass}>Day of Week *</label>
                <select value={dayOfWeek} onChange={(e) => setDayOfWeek(e.target.value)} className={inputClass}>
                  {DAY_OF_WEEK_LABELS.map((label, i) => (
                    <option key={i} value={i}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Start / End dates */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Start Date *</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
              {errors.startDate && <p className={errorClass}>{errors.startDate}</p>}
            </div>
            <div>
              <label className={labelClass}>End Date (optional)</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
              {errors.endDate && <p className={errorClass}>{errors.endDate}</p>}
            </div>
          </div>

          {/* Auto-confirm toggle */}
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50/30 px-4 py-3 dark:border-stone-700 dark:bg-stone-700/20">
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={autoConfirm}
                onChange={(e) => setAutoConfirm(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-stone-300 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-emerald-500 peer-checked:after:translate-x-full peer-focus:ring-2 peer-focus:ring-emerald-500 dark:bg-stone-600 dark:peer-checked:bg-emerald-500" />
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-stone-700 dark:text-stone-300">Auto-post on due date</span>
              <span className="group relative inline-flex cursor-default">
                <svg className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-56 -translate-x-1/2 rounded-lg bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-stone-700">
                  Disable for variable amounts that need review before posting.
                </span>
              </span>
            </div>
          </div>
        </>)}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-amber-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : isEditing ? 'Update Template' : 'Create Template'}
        </button>
      </div>
    </form>
  );
}
