import { useEffect, useState, useMemo } from 'react';
import { toCents, toDollars, CATEGORY_TYPE_ORDER, CATEGORY_TYPE_LABELS, formatCurrency, maskAccountName } from '../../utils/helpers';
import { ACCOUNT_TYPES } from '../../services/accounts';
import { FREQUENCY_OPTIONS, DAY_OF_WEEK_LABELS } from '../../utils/recurringCalculations';

/**
 * Create a blank child line item for the group.
 * Inherits accountId and payee from group defaults.
 */
function blankChild(defaults = {}) {
  return {
    _key: crypto.randomUUID(),
    id: null,
    txType: 'expense',
    description: '',
    amount: '',
    categoryId: '',
    accountId: defaults.accountId || '',
    toAccountId: '',
    linkedAccountId: '',
    payee: defaults.payee || '',
  };
}

/**
 * RecurringGroupForm — create or edit a recurring transaction group.
 *
 * The group parent stores administrative/default values (name, payee, account,
 * schedule) that serve as defaults for line items. Each line item is a real
 * transaction (expense, income, or transfer) that gets posted when applied.
 *
 * Props:
 *  - categories: Array of category objects
 *  - accounts: Array of account objects
 *  - initialValues: optional group parent object with `children` array (editing)
 *  - onSubmit(parentData, childrenData): called with data for service layer
 *  - onCancel(): close form
 *  - isEditing: boolean flag
 */
export default function RecurringGroupForm({
  categories = [],
  accounts = [],
  initialValues,
  onSubmit,
  onCancel,
  isEditing = false,
}) {
  // ── Parent state ──
  const [description, setDescription] = useState('');
  const [payee, setPayee] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [dayOfMonth2, setDayOfMonth2] = useState('15');
  const [dayOfWeek, setDayOfWeek] = useState('0');
  const [customInterval, setCustomInterval] = useState(2);
  const [customUnit, setCustomUnit] = useState('days');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [autoConfirm, setAutoConfirm] = useState(true);

  // ── Children state ──
  const [children, setChildren] = useState([blankChild()]);

  // ── UI state ──
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(!isEditing);

  // ── Derived ──
  const needsDayOfMonth = ['monthly', 'semi_monthly', 'quarterly', 'yearly'].includes(frequency)
    || (frequency === 'custom' && customUnit === 'months');
  const needsDayOfMonth2 = frequency === 'semi_monthly';
  const needsDayOfWeek = ['weekly', 'biweekly'].includes(frequency);

  // Group accounts by type
  const groupedAccounts = useMemo(() =>
    Object.entries(
      accounts.reduce((acc, a) => {
        const label = ACCOUNT_TYPES[a.type]?.label || a.type;
        if (!acc[label]) acc[label] = [];
        acc[label].push(a);
        return acc;
      }, {}),
    ),
  [accounts]);

  // Group all categories by type (for optional parent category selector)
  const groupedCategories = useMemo(() =>
    CATEGORY_TYPE_ORDER
      .map((type) => ({
        type,
        label: CATEGORY_TYPE_LABELS[type],
        items: categories.filter((c) => c.type === type),
      }))
      .filter((g) => g.items.length > 0),
  [categories]);

  // ── Calculate net summary from children ──
  const summary = useMemo(() => {
    let incomeCents = 0;
    let expenseCents = 0;
    let transferCents = 0;
    for (const child of children) {
      const cents = toCents(parseFloat(child.amount) || 0);
      if (child.txType === 'income') incomeCents += cents;
      else if (child.txType === 'expense') expenseCents += cents;
      else if (child.txType === 'transfer') transferCents += cents;
    }
    const netCents = incomeCents - expenseCents - transferCents;
    return { incomeCents, expenseCents, transferCents, netCents };
  }, [children]);

  // Populate form when editing
  useEffect(() => {
    if (initialValues) {
      setDescription(initialValues.description || '');
      setPayee(initialValues.payee || '');
      setAccountId(initialValues.account_id || '');
      setCategoryId(initialValues.category_id || '');
      setFrequency(initialValues.frequency || 'monthly');
      setDayOfMonth(String(initialValues.day_of_month || 1));
      setDayOfMonth2(String(initialValues.day_of_month_2 || 15));
      setDayOfWeek(String(initialValues.day_of_week ?? 0));
      setCustomInterval(initialValues.custom_interval || 2);
      setCustomUnit(initialValues.custom_unit || 'months');
      setStartDate(initialValues.start_date || '');
      setEndDate(initialValues.end_date || '');
      setAutoConfirm(initialValues.auto_confirm !== false);

      if (initialValues.children?.length > 0) {
        setChildren(
          initialValues.children.map((c) => ({
            _key: crypto.randomUUID(),
            id: c.id || null,
            txType: c.is_transfer ? 'transfer' : c.is_income ? 'income' : 'expense',
            description: c.description || '',
            amount: String(toDollars(Math.abs(c.amount))),
            categoryId: c.category_id || '',
            accountId: c.account_id || initialValues.account_id || '',
            toAccountId: c.is_transfer ? (c.to_account_id || '') : '',
            linkedAccountId: (!c.is_transfer && c.to_account_id) ? c.to_account_id : '',
            payee: c.payee || '',
          })),
        );
      }
    }
  }, [initialValues]);

  // Default start date to today for new groups
  useEffect(() => {
    if (!isEditing && !startDate) {
      setStartDate(new Date().toISOString().split('T')[0]);
    }
  }, [isEditing, startDate]);

  // ── Child handlers ──
  const updateChild = (index, field, value) => {
    setChildren((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const addChild = () => {
    setChildren((prev) => [...prev, blankChild({ accountId, payee })]);
  };

  const removeChild = (index) => {
    if (children.length <= 1) return;
    setChildren((prev) => prev.filter((_, i) => i !== index));
  };

  // ── Categories for children based on their type ──
  const getChildCategories = (childTxType) => {
    if (childTxType === 'transfer') return categories.filter((c) => c.type === 'transfer');
    return categories.filter((c) => c.type !== 'transfer');
  };

  const getGroupedChildCategories = (childTxType) => {
    const filtered = getChildCategories(childTxType);
    return CATEGORY_TYPE_ORDER
      .map((type) => ({
        type,
        label: CATEGORY_TYPE_LABELS[type],
        items: filtered.filter((c) => c.type === type),
      }))
      .filter((g) => g.items.length > 0);
  };

  // ── Validation ──
  const validate = () => {
    const errs = {};
    if (!description.trim()) errs.description = 'Group name is required';
    if (!payee.trim()) errs.payee = 'Default payee is required';
    if (!accountId) errs.accountId = 'Default account is required';
    if (!startDate) errs.startDate = 'Start date is required';
    if (endDate && endDate < startDate) errs.endDate = 'End date must be after start date';
    if (frequency === 'custom') {
      const iv = parseInt(customInterval, 10);
      if (isNaN(iv) || iv < 1) errs.customInterval = 'Interval must be at least 1';
    }
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
    if (children.length === 0) errs.children = 'At least one line item is required';

    // Validate each child — description is optional, payee is optional (inherits from group)
    const childErrors = {};
    children.forEach((child, i) => {
      const ce = {};
      const amt = parseFloat(child.amount);
      if (!child.amount || isNaN(amt) || amt <= 0) ce.amount = 'Required';
      if (!child.categoryId) ce.categoryId = 'Required';
      if (!child.accountId) ce.accountId = 'Required';
      if (child.txType === 'transfer' && !child.toAccountId) ce.toAccountId = 'Required';
      if (child.txType === 'transfer' && child.toAccountId === child.accountId) ce.toAccountId = 'Must differ';
      if (Object.keys(ce).length > 0) childErrors[i] = ce;
    });
    if (Object.keys(childErrors).length > 0) errs.childErrors = childErrors;

    setErrors(errs);
    const hasParentErrors = ['description', 'payee', 'accountId', 'startDate', 'endDate', 'dayOfMonth', 'dayOfMonth2', 'customInterval'].some((k) => errs[k]);
    if (hasParentErrors) setDetailsOpen(true);
    return Object.keys(errs).length === 0;
  };

  // ── Submit ──
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSaving(true);
    setSubmitError('');

    try {
      // Calculate net from children for parent amount
      const childrenData = children.map((child) => {
        const isIncome = child.txType === 'income';
        const isTransfer = child.txType === 'transfer';
        const amountCents = toCents(parseFloat(child.amount));

        return {
          id: child.id || undefined,
          account_id: child.accountId,
          category_id: child.categoryId,
          description: child.description?.trim() || null,
          payee: child.payee?.trim() || null,
          amount: Math.abs(amountCents),
          is_income: isIncome,
          is_transfer: isTransfer,
          to_account_id: isTransfer ? child.toAccountId : (child.linkedAccountId || null),
        };
      });

      // Parent amount = calculated net (sum of signed child amounts)
      // Transfers are excluded; expenses are negated since c.amount is always Math.abs()
      const netAmount = childrenData.reduce((sum, c) => {
        if (c.is_transfer) return sum;
        return sum + (c.is_income ? c.amount : -c.amount);
      }, 0);

      // Parent category: use selected category, fall back to first child's category
      const parentCategoryId = categoryId || childrenData[0]?.category_id || categories[0]?.id;

      const parentData = {
        account_id: accountId,
        category_id: parentCategoryId,
        description: description.trim(),
        payee: payee.trim(),
        amount: netAmount,
        is_income: netAmount >= 0,
        frequency,
        day_of_month: needsDayOfMonth ? parseInt(dayOfMonth, 10) : null,
        day_of_month_2: needsDayOfMonth2 ? parseInt(dayOfMonth2, 10) : null,
        day_of_week: needsDayOfWeek ? parseInt(dayOfWeek, 10) : null,
        custom_interval: frequency === 'custom' ? parseInt(customInterval, 10) : null,
        custom_unit: frequency === 'custom' ? customUnit : null,
        start_date: startDate,
        end_date: endDate || null,
        auto_confirm: autoConfirm,
      };

      await onSubmit(parentData, childrenData);
    } catch (err) {
      setSubmitError(err?.message || 'Failed to save recurring group');
    } finally {
      setIsSaving(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-stone-200 bg-white px-4 py-1.5 sm:py-2.5 text-sm text-stone-900 shadow-sm transition-all focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100';
  const cellInputClass =
    'w-full rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-xs text-stone-900 transition-all focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100';
  const labelClass = 'mb-1 sm:mb-1.5 block text-sm font-medium text-stone-700 dark:text-stone-300';
  const errorClass = 'mt-1 text-xs text-red-500';
  const cellErrorClass = 'text-[10px] text-red-500';

  // Type badge colors
  const typeBadge = (type, active) => {
    const base = 'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none transition-all cursor-pointer';
    if (!active) return `${base} text-stone-400 hover:bg-stone-100 dark:text-stone-500 dark:hover:bg-stone-700`;
    if (type === 'expense') return `${base} bg-amber-500 text-white shadow-sm`;
    if (type === 'income') return `${base} bg-emerald-500 text-white shadow-sm`;
    return `${base} bg-blue-500 text-white shadow-sm`;
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {submitError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {submitError}
        </div>
      )}

      {/* ── Group Details (Administrative / Defaults) ── */}
      <div className="rounded-xl border border-stone-200/60 bg-stone-50/50 p-4 dark:border-stone-700/40 dark:bg-stone-800/50">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          className="mb-3 flex w-full items-center justify-between rounded-lg text-left"
        >
          <span className="flex items-center text-sm font-semibold text-stone-800 dark:text-stone-200">
            Group Details
            <span className="group relative ml-1.5 inline-flex cursor-default">
              <svg className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-52 -translate-x-1/2 rounded-lg bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-stone-700">
                Administrative defaults inherited by new line items.
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2">
            {!detailsOpen && description && (
              <span className="max-w-25 truncate text-xs font-normal text-stone-500 dark:text-stone-400">
                {description}
              </span>
            )}
            {!detailsOpen && (
              <span className="text-xs font-normal text-amber-600 dark:text-amber-400">
                {FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.label}
              </span>
            )}
            <svg
              className={`h-4 w-4 shrink-0 text-stone-400 transition-transform dark:text-stone-500 ${detailsOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </span>
        </button>
        {detailsOpen && (<>

        {/* Name + Payee */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Group Name *</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Paycheck, Mortgage Payment"
              className={inputClass}
            />
            {errors.description && <p className={errorClass}>{errors.description}</p>}
          </div>
          <div>
            <label className={labelClass}>
              Default Payee *
              <span className="group relative ml-1.5 inline-flex cursor-default">
                <svg className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-52 -translate-x-1/2 rounded-lg bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-stone-700">
                  Applied to line items that don't specify their own.
                </span>
              </span>
            </label>
            <input
              type="text"
              value={payee}
              onChange={(e) => setPayee(e.target.value)}
              placeholder="e.g., Employer Inc., Bank of America"
              className={inputClass}
            />
            {errors.payee && <p className={errorClass}>{errors.payee}</p>}
          </div>
        </div>

        {/* Account + Category (optional) */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>
              Default Account *
              <span className="group relative ml-1.5 inline-flex cursor-default">
                <svg className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-52 -translate-x-1/2 rounded-lg bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-stone-700">
                  Default account for new line items.
                </span>
              </span>
            </label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputClass}>
              <option value="">Select account…</option>
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
            <label className={labelClass}>
              Default Category
              <span className="group relative ml-1.5 inline-flex cursor-default">
                <svg className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
                <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-52 -translate-x-1/2 rounded-lg bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-stone-700">
                  For reference only — not applied to line items.
                </span>
              </span>
            </label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              <option value="">None (optional)</option>
              {groupedCategories.map((g) => (
                <optgroup key={g.type} label={g.label}>
                  {g.items.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>

        {/* Frequency */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Frequency *</label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)} className={inputClass}>
              {FREQUENCY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {/* Custom interval inputs — tucked under the frequency selector */}
            {frequency === 'custom' && (
              <div className="mt-2">
                <label className={labelClass}>Repeat Every *</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={customInterval}
                    onChange={(e) => setCustomInterval(e.target.value)}
                    className="w-16 shrink-0 rounded-xl border border-stone-200 bg-white px-3 py-1.5 sm:py-2.5 text-sm text-stone-900 shadow-sm transition-all focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  />
                  <select
                    value={customUnit}
                    onChange={(e) => setCustomUnit(e.target.value)}
                    className="flex-1 min-w-0 rounded-xl border border-stone-200 bg-white px-3 py-1.5 sm:py-2.5 text-sm text-stone-900 shadow-sm transition-all focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                  >
                    <option value="days">Days</option>
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                  </select>
                </div>
                {errors.customInterval && <p className={errorClass}>{errors.customInterval}</p>}
              </div>
            )}
          </div>

          {needsDayOfMonth && (
            <div>
              <label className={labelClass}>{needsDayOfMonth2 ? 'First Day of Month *' : 'Day of Month *'}</label>
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
              <label className={labelClass}>Second Day of Month *</label>
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
                  <option key={i} value={i}>{label}</option>
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
        <label className="mt-3 flex items-center gap-2 cursor-pointer">
          <button
            type="button"
            role="switch"
            aria-checked={autoConfirm}
            onClick={() => setAutoConfirm(!autoConfirm)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              autoConfirm ? 'bg-emerald-500' : 'bg-stone-300 dark:bg-stone-600'
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                autoConfirm ? 'translate-x-[18px]' : 'translate-x-[3px]'
              }`}
            />
          </button>
          <span className="text-xs text-stone-600 dark:text-stone-400">
            Auto-post on due date
          </span>
          <span className="group relative inline-flex cursor-default">
            <svg className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 w-56 -translate-x-1/2 rounded-lg bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-stone-700">
              Disable for variable amounts that need review before posting.
            </span>
          </span>
        </label>
        </>)}
      </div>

      {/* ── Line Items (Table Layout) ── */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-800 dark:text-stone-200">
            Line Items
            <span className="ml-2 text-xs font-normal text-stone-400">({children.length})</span>
          </h3>
          <button
            type="button"
            onClick={addChild}
            className="flex items-center gap-1.5 rounded-lg bg-stone-100 px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-200 dark:bg-stone-700 dark:text-stone-300 dark:hover:bg-stone-600"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add
          </button>
        </div>

        {errors.children && <p className={errorClass}>{errors.children}</p>}

        {/* Desktop table layout */}
        <div className="hidden sm:block">
          <div className="rounded-xl border border-stone-200/60 bg-white shadow-sm dark:border-stone-700/40 dark:bg-stone-800/80">
            {/* Table header */}
            <div className="grid grid-cols-[60px_1fr_1fr_90px_1fr_1fr_100px_36px] gap-1 border-b border-stone-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:border-stone-700/40 dark:text-stone-500">
              <span>Type</span>
              <span>Payee</span>
              <span>Description</span>
              <span>Amount</span>
              <span>Category</span>
              <span>Account</span>
              <span>Linked</span>
              <span />
            </div>

            {/* Table rows */}
            {children.map((child, index) => {
              const childErrs = errors.childErrors?.[index] || {};
              const childGroupedCats = getGroupedChildCategories(child.txType);
              const hasErrors = Object.keys(childErrs).length > 0;

              return (
                <div key={child._key}>
                  <div
                    className={`grid grid-cols-[60px_1fr_1fr_90px_1fr_1fr_100px_36px] items-center gap-1 px-3 py-1.5 ${
                      hasErrors ? 'bg-red-50/50 dark:bg-red-950/10' : ''
                    } ${index > 0 ? 'border-t border-stone-50 dark:border-stone-700/20' : ''}`}
                  >
                    {/* Type toggle */}
                    <div className="flex gap-0.5">
                      {['expense', 'income', 'transfer'].map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => {
                            updateChild(index, 'txType', type);
                            updateChild(index, 'categoryId', '');
                          }}
                          className={typeBadge(type, child.txType === type)}
                          title={type.charAt(0).toUpperCase() + type.slice(1)}
                        >
                          {type === 'expense' ? 'E' : type === 'income' ? 'I' : 'T'}
                        </button>
                      ))}
                    </div>

                    {/* Payee */}
                    <div>
                      <input
                        type="text"
                        value={child.payee}
                        onChange={(e) => updateChild(index, 'payee', e.target.value)}
                        placeholder={payee || 'Payee'}
                        className={cellInputClass}
                      />
                    </div>

                    {/* Description (optional) */}
                    <div>
                      <input
                        type="text"
                        value={child.description}
                        onChange={(e) => updateChild(index, 'description', e.target.value)}
                        placeholder="Optional"
                        className={cellInputClass}
                      />
                    </div>

                    {/* Amount */}
                    <div>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={child.amount}
                        onChange={(e) => updateChild(index, 'amount', e.target.value)}
                        placeholder="0.00"
                        className={`${cellInputClass} ${childErrs.amount ? 'border-red-300 dark:border-red-700' : ''}`}
                      />
                    </div>

                    {/* Category */}
                    <div>
                      <select
                        value={child.categoryId}
                        onChange={(e) => updateChild(index, 'categoryId', e.target.value)}
                        className={`${cellInputClass} ${childErrs.categoryId ? 'border-red-300 dark:border-red-700' : ''}`}
                      >
                        <option value="">Select…</option>
                        {childGroupedCats.map((g) => (
                          <optgroup key={g.type} label={g.label}>
                            {g.items.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {/* Account (From account for transfers) */}
                    <div>
                      <select
                        value={child.accountId}
                        onChange={(e) => updateChild(index, 'accountId', e.target.value)}
                        className={`${cellInputClass} w-full ${childErrs.accountId ? 'border-red-300 dark:border-red-700' : ''}`}
                      >
                        <option value="">{child.txType === 'transfer' ? 'From…' : 'Account…'}</option>
                        {groupedAccounts.map(([group, accts]) => (
                          <optgroup key={group} label={group}>
                            {accts.map((a) => (
                              <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </div>

                    {/* Linked Account / To Account for transfers */}
                    <div>
                      {child.txType === 'transfer' ? (
                        <select
                          value={child.toAccountId}
                          onChange={(e) => updateChild(index, 'toAccountId', e.target.value)}
                          className={`${cellInputClass} ${childErrs.toAccountId ? 'border-red-300 dark:border-red-700' : ''}`}
                        >
                          <option value="">To…</option>
                          {groupedAccounts.map(([group, accts]) => (
                            <optgroup key={group} label={group}>
                              {accts.map((a) => (
                                <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      ) : (
                        <select
                          value={child.linkedAccountId}
                          onChange={(e) => updateChild(index, 'linkedAccountId', e.target.value)}
                          className={cellInputClass}
                          title="Linked account (optional) — creates a neutral companion"
                        >
                          <option value="">None</option>
                          {groupedAccounts.map(([group, accts]) => (
                            <optgroup key={group} label={group}>
                              {accts.filter((a) => a.id !== child.accountId).map((a) => (
                                <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      )}
                    </div>

                    {/* Delete */}
                    <div className="flex justify-center">
                      {children.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeChild(index)}
                          className="rounded p-1 text-stone-300 transition-colors hover:bg-red-100 hover:text-red-500 dark:text-stone-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                          title="Remove"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Inline errors row */}
                  {hasErrors && (
                    <div className="grid grid-cols-[60px_1fr_1fr_90px_1fr_1fr_100px_36px] gap-1 bg-red-50/50 px-3 pb-1 dark:bg-red-950/10">
                      <span />
                      <span />
                      <span />
                      <span>{childErrs.amount && <span className={cellErrorClass}>{childErrs.amount}</span>}</span>
                      <span>{childErrs.categoryId && <span className={cellErrorClass}>{childErrs.categoryId}</span>}</span>
                      <span>
                        {childErrs.accountId && <span className={cellErrorClass}>{childErrs.accountId}</span>}
                        {childErrs.toAccountId && <span className={cellErrorClass}> {childErrs.toAccountId}</span>}
                      </span>
                      <span />
                      <span />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Mobile card layout (fallback) */}
        <div className="space-y-2 sm:hidden">
          {children.map((child, index) => {
            const childErrs = errors.childErrors?.[index] || {};
            const childGroupedCats = getGroupedChildCategories(child.txType);

            return (
              <div
                key={child._key}
                className="rounded-xl border border-stone-200/60 bg-white p-3 shadow-sm dark:border-stone-700/40 dark:bg-stone-800/80"
              >
                {/* Top row: type badges + delete */}
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex gap-0.5">
                    {['expense', 'income', 'transfer'].map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => {
                          updateChild(index, 'txType', type);
                          updateChild(index, 'categoryId', '');
                        }}
                        className={typeBadge(type, child.txType === type)}
                      >
                        {type === 'expense' ? 'E' : type === 'income' ? 'I' : 'T'}
                      </button>
                    ))}
                  </div>
                  {children.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeChild(index)}
                      className="rounded p-1 text-stone-300 hover:text-red-500"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                {/* Amount + Payee */}
                <div className="mb-1.5 grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={child.amount}
                    onChange={(e) => updateChild(index, 'amount', e.target.value)}
                    placeholder="$0.00"
                    className={`${cellInputClass} ${childErrs.amount ? 'border-red-300 dark:border-red-700' : ''}`}
                  />
                  <input
                    type="text"
                    value={child.payee}
                    onChange={(e) => updateChild(index, 'payee', e.target.value)}
                    placeholder={payee || 'Payee'}
                    className={cellInputClass}
                  />
                </div>
                {/* Description + Category */}
                <div className="mb-1.5 grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={child.description}
                    onChange={(e) => updateChild(index, 'description', e.target.value)}
                    placeholder="Description"
                    className={cellInputClass}
                  />
                  <select
                    value={child.categoryId}
                    onChange={(e) => updateChild(index, 'categoryId', e.target.value)}
                    className={`${cellInputClass} ${childErrs.categoryId ? 'border-red-300 dark:border-red-700' : ''}`}
                  >
                    <option value="">Category…</option>
                    {childGroupedCats.map((g) => (
                      <optgroup key={g.type} label={g.label}>
                        {g.items.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                {/* Account + Linked (or To Account for transfers) */}
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={child.accountId}
                    onChange={(e) => updateChild(index, 'accountId', e.target.value)}
                    className={`${cellInputClass} ${childErrs.accountId ? 'border-red-300 dark:border-red-700' : ''}`}
                  >
                    <option value="">{child.txType === 'transfer' ? 'From…' : 'Account…'}</option>
                    {groupedAccounts.map(([group, accts]) => (
                      <optgroup key={group} label={group}>
                        {accts.map((a) => (
                          <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {child.txType === 'transfer' ? (
                    <select
                      value={child.toAccountId}
                      onChange={(e) => updateChild(index, 'toAccountId', e.target.value)}
                      className={`${cellInputClass} ${childErrs.toAccountId ? 'border-red-300 dark:border-red-700' : ''}`}
                    >
                      <option value="">To…</option>
                      {groupedAccounts.map(([group, accts]) => (
                        <optgroup key={group} label={group}>
                          {accts.map((a) => (
                            <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  ) : (
                    <select
                      value={child.linkedAccountId}
                      onChange={(e) => updateChild(index, 'linkedAccountId', e.target.value)}
                      className={cellInputClass}
                      title="Linked account (optional) — creates a neutral companion"
                    >
                      <option value="">Linked…</option>
                      {groupedAccounts.map(([group, accts]) => (
                        <optgroup key={group} label={group}>
                          {accts.filter((a) => a.id !== child.accountId).map((a) => (
                            <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  )}
                </div>
                {/* Inline errors */}
                {Object.keys(childErrs).length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {Object.entries(childErrs).map(([field, msg]) => (
                      <span key={field} className={cellErrorClass}>{field}: {msg}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Net Summary (read-only) ── */}
      {children.some((c) => parseFloat(c.amount) > 0) && (
        <div className="rounded-xl border border-stone-200/60 bg-gradient-to-r from-stone-50 to-stone-100 p-4 dark:border-stone-700/40 dark:from-stone-800/50 dark:to-stone-800/80">
          <h3 className="mb-3 text-sm font-semibold text-stone-800 dark:text-stone-200">
            Summary
          </h3>
          <div className="space-y-1.5 text-sm">
            {summary.incomeCents > 0 && (
              <div className="flex justify-between">
                <span className="text-stone-600 dark:text-stone-400">Income</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  +{formatCurrency(summary.incomeCents)}
                </span>
              </div>
            )}
            {summary.expenseCents > 0 && (
              <div className="flex justify-between">
                <span className="text-stone-600 dark:text-stone-400">Expenses</span>
                <span className="font-semibold text-red-600 dark:text-red-400">
                  −{formatCurrency(summary.expenseCents)}
                </span>
              </div>
            )}
            {summary.transferCents > 0 && (
              <div className="flex justify-between">
                <span className="text-stone-600 dark:text-stone-400">Transfers</span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">
                  −{formatCurrency(summary.transferCents)}
                </span>
              </div>
            )}
            <div className="border-t border-stone-200 pt-2 dark:border-stone-700">
              <div className="flex justify-between">
                <span className="font-semibold text-stone-700 dark:text-stone-300">Net</span>
                <span
                  className={`text-lg font-bold ${
                    summary.netCents > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : summary.netCents < 0
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-stone-600 dark:text-stone-400'
                  }`}
                >
                  {summary.netCents > 0 ? '+' : summary.netCents < 0 ? '−' : ''}
                  {formatCurrency(Math.abs(summary.netCents))}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Actions ── */}
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
          {isSaving ? 'Saving…' : isEditing ? 'Update Group' : 'Create Group'}
        </button>
      </div>
    </form>
  );
}
