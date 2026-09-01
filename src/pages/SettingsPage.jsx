import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import TopBar from '../components/common/TopBar';
import ExportData from '../components/common/ExportData';
import ImportCSV from '../components/transactions/ImportCSV';
import BudgetImportModal from '../components/budgets/BudgetImportModal';
import { useCategories, useAccounts, useUserPreference } from '../hooks/queries';
import useThresholds from '../hooks/useThresholds';
import useTheme from '../hooks/useTheme';
import useSafeMode from '../hooks/useSafeMode';
import { DEFAULT_THRESHOLDS } from '../utils/budgetCalculations';
import { maskAccountName } from '../utils/helpers';
import {
  QUICK_TRANSACTION_TEMPLATES_KEY,
  normalizeQuickTransactionTemplates,
  saveQuickTransactionTemplates,
} from '../services/quickTransactions';
import { getPartnership } from '../services/partnerships';

export default function SettingsPage() {
  const {
    thresholds,
    setThresholds,
    resetThresholds,
    isLoading,
    error: loadError,
  } = useThresholds();

  const { isDark, toggleTheme } = useTheme();
  const { isSafeMode, toggleSafeMode } = useSafeMode();

  const [underBudgetInput, setUnderBudgetInput] = useState(null); // null = use loaded value
  const [warningInput, setWarningInput] = useState(null);
  const [dangerInput, setDangerInput] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'success' | 'error'
  const [validationError, setValidationError] = useState('');

  // Import modal state
  const [showImportModal, setShowImportModal] = useState(false);
  const [showBudgetImportModal, setShowBudgetImportModal] = useState(false);

  // Category/account data is also used by quick-transaction template settings.
  const { data: categories = [] } = useCategories();
  const { data: accounts = [] } = useAccounts();

  // Quick templates preference
  const quickTemplatesQuery = useUserPreference(QUICK_TRANSACTION_TEMPLATES_KEY);
  const quickTemplates = useMemo(
    () => normalizeQuickTransactionTemplates(quickTemplatesQuery.data),
    [quickTemplatesQuery.data],
  );
  const [quickForm, setQuickForm] = useState({
    id: null,
    label: '',
    description: '',
    payee: '',
    account_id: '',
    category_id: '',
    is_income: false,
    is_split: false,
    split_method: 'equal',
    split_payer: 'me',
    split_partner_share_pct: 50,
  });
  const [quickFormError, setQuickFormError] = useState('');
  const [quickSaving, setQuickSaving] = useState(false);
  const [partnership, setPartnership] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getPartnership()
      .then((p) => {
        if (!cancelled) setPartnership(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolve displayed values: local overrides while editing, else loaded thresholds
  const displayUnderBudget = underBudgetInput ?? thresholds.underBudget;
  const displayWarning = warningInput ?? thresholds.warning;
  const displayDanger = dangerInput ?? thresholds.danger;

  const validate = (u, w, d) => {
    if (u == null || w == null || d == null || isNaN(u) || isNaN(w) || isNaN(d)) return 'All values are required.';
    if (u <= 0) return 'Under budget threshold must be greater than 0%.';
    if (w <= 0) return 'Warning threshold must be greater than 0%.';
    if (u >= w) return 'Under budget threshold must be less than the warning threshold.';
    if (d <= w) return 'Danger threshold must be greater than the warning threshold.';
    return '';
  };

  const handleSave = async () => {
    const u = Number(displayUnderBudget);
    const w = Number(displayWarning);
    const d = Number(displayDanger);
    const err = validate(u, w, d);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError('');
    setSaveStatus('');
    setIsSaving(true);
    try {
      await setThresholds({ underBudget: u, warning: w, danger: d });
      setSaveStatus('success');
      // Clear local overrides so hook state is used
      setUnderBudgetInput(null);
      setWarningInput(null);
      setDangerInput(null);
      setTimeout(() => setSaveStatus(''), 3000);
    } catch {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    setValidationError('');
    setSaveStatus('');
    setIsSaving(true);
    try {
      await resetThresholds();
      setUnderBudgetInput(null);
      setWarningInput(null);
      setDangerInput(null);
      setSaveStatus('success');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const isDefault =
    thresholds.underBudget === DEFAULT_THRESHOLDS.underBudget &&
    thresholds.warning === DEFAULT_THRESHOLDS.warning &&
    thresholds.danger === DEFAULT_THRESHOLDS.danger &&
    underBudgetInput == null &&
    warningInput == null &&
    dangerInput == null;

  useEffect(() => { document.title = 'Budget App | Settings'; }, []);

  const nonTransferCategories = categories.filter((c) => c.type !== 'transfer');
  const groupedQuickCategories = {
    income: nonTransferCategories.filter((c) => c.type === 'income'),
    needs: nonTransferCategories.filter((c) => c.type === 'needs'),
    wants: nonTransferCategories.filter((c) => c.type === 'wants'),
    savings: nonTransferCategories.filter((c) => c.type === 'savings'),
  };
  const openAccounts = accounts.filter((a) => !a.closed_at || a.id === quickForm.account_id);

  const resetQuickForm = () => {
    setQuickForm({
      id: null,
      label: '',
      description: '',
      payee: '',
      account_id: '',
      category_id: '',
      is_income: false,
      is_split: false,
      split_method: 'equal',
      split_payer: 'me',
      split_partner_share_pct: 50,
    });
    setQuickFormError('');
  };

  const handleQuickEdit = (tpl) => {
    setQuickForm({
      id: tpl.id,
      label: tpl.label || '',
      description: tpl.description || '',
      payee: tpl.payee || '',
      account_id: tpl.account_id || '',
      category_id: tpl.category_id || '',
      is_income: !!tpl.is_income,
      is_split: !!tpl.is_split,
      split_method: tpl.split_method || 'equal',
      split_payer: tpl.split_payer || 'me',
      split_partner_share_pct: tpl.split_partner_share_pct ?? 50,
    });
    setQuickFormError('');
  };

  const handleQuickDelete = async (id) => {
    setQuickSaving(true);
    setQuickFormError('');
    try {
      await saveQuickTransactionTemplates(quickTemplates.filter((t) => t.id !== id));
      if (quickForm.id === id) resetQuickForm();
    } catch (err) {
      setQuickFormError(err?.message || 'Failed to delete quick template.');
    } finally {
      setQuickSaving(false);
    }
  };

  const handleQuickSave = async () => {
    if (!quickForm.label.trim()) {
      setQuickFormError('Template name is required.');
      return;
    }
    if (!quickForm.description.trim()) {
      setQuickFormError('Description is required.');
      return;
    }
    if (!quickForm.account_id) {
      setQuickFormError('Account is required.');
      return;
    }
    if (!quickForm.category_id) {
      setQuickFormError('Category is required.');
      return;
    }
    if (quickForm.is_split && quickForm.split_method === 'custom') {
      const pct = Number(quickForm.split_partner_share_pct);
      if (!Number.isFinite(pct) || pct < 1 || pct > 99) {
        setQuickFormError('Custom split must be between 1% and 99%.');
        return;
      }
    }

    const template = {
      id: quickForm.id || crypto.randomUUID(),
      label: quickForm.label.trim(),
      description: quickForm.description.trim(),
      payee: quickForm.payee.trim(),
      account_id: quickForm.account_id,
      category_id: quickForm.category_id,
      is_income: quickForm.is_income,
      is_split: partnership ? quickForm.is_split : false,
      split_method: partnership ? quickForm.split_method : 'equal',
      split_payer: partnership ? quickForm.split_payer : 'me',
      split_partner_share_pct: partnership
        ? Number(quickForm.split_partner_share_pct ?? 50)
        : 50,
      is_active: true,
      sort_order: 0,
    };

    let next;
    if (quickForm.id) {
      next = quickTemplates.map((t) => (t.id === quickForm.id ? { ...t, ...template } : t));
    } else {
      next = [...quickTemplates, { ...template, sort_order: quickTemplates.length }];
    }

    setQuickSaving(true);
    setQuickFormError('');
    try {
      await saveQuickTransactionTemplates(
        next.map((t, idx) => ({ ...t, sort_order: idx })),
      );
      resetQuickForm();
    } catch (err) {
      setQuickFormError(err?.message || 'Failed to save quick template.');
    } finally {
      setQuickSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <TopBar pageName="Settings" />

      {/* Content */}
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <div className="animate-fade-in mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-stone-900 dark:text-stone-100">Settings</h1>
          <p className="mt-2 text-base text-stone-500 dark:text-stone-400">
            Customise appearance, budget alerts, and app preferences.
          </p>
        </div>

        {/* ── Row 1: Appearance + Safe Mode ────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">

        {/* ── Appearance ───────────────────────────────── */}
        <div className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
          <h2 className="mb-1 text-lg font-semibold text-stone-900 dark:text-stone-100">Appearance</h2>
          <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">Choose between light and dark mode.</p>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Sun / Moon icon */}
              {isDark ? (
                <svg className="h-5 w-5 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              )}
              <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
                {isDark ? 'Dark mode' : 'Light mode'}
              </span>
            </div>

            {/* Toggle switch */}
            <button
              type="button"
              role="switch"
              aria-checked={isDark}
              onClick={toggleTheme}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-stone-800 ${
                isDark ? 'bg-amber-500' : 'bg-stone-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${
                  isDark ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>

        {/* ── Safe Mode ───────────────────────────────── */}
        <div className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
          <h2 className="mb-1 text-lg font-semibold text-stone-900 dark:text-stone-100">Safe Mode</h2>
          <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
            Mask financial values and account names for presentations or screen sharing.
          </p>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Shield / Eye-off icon */}
              {isSafeMode ? (
                <svg className="h-5 w-5 text-violet-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-stone-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              )}
              <span className="text-sm font-medium text-stone-700 dark:text-stone-300">
                {isSafeMode ? 'Safe mode on' : 'Safe mode off'}
              </span>
            </div>

            {/* Toggle switch */}
            <button
              type="button"
              role="switch"
              aria-checked={isSafeMode}
              onClick={toggleSafeMode}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-stone-800 ${
                isSafeMode ? 'bg-violet-500' : 'bg-stone-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition-transform duration-200 ${
                  isSafeMode ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {isSafeMode && (
            <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-900/20 dark:text-violet-300">
              All dollar amounts are scrambled and account names are masked. Toggle off to see real values.
            </p>
          )}
        </div>

        </div>{/* end Row 1 */}

        {/* ── Row 2: Main content ─────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">

        {/* ── Left column: Budget Thresholds + Manage Categories ── */}
        <div className="flex flex-col gap-6">

        {/* ── Quick Transactions ────────────────────── */}
        <div className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
          <h2 className="mb-1 text-lg font-semibold text-stone-900 dark:text-stone-100">Quick Transactions</h2>
          <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
            Save transaction defaults so you only enter the amount when posting.
          </p>

          {quickFormError && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
              {quickFormError}
            </div>
          )}

          <div className="space-y-3">
            {quickTemplates.length === 0 ? (
              <p className="rounded-xl border border-dashed border-stone-200 px-3 py-2 text-sm text-stone-500 dark:border-stone-700 dark:text-stone-400">
                No quick templates yet.
              </p>
            ) : (
              quickTemplates.map((tpl) => (
                <div key={tpl.id} className="flex items-center justify-between rounded-xl border border-stone-200/60 bg-stone-50/50 px-3 py-2 dark:border-stone-700/60 dark:bg-stone-900/30">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-800 dark:text-stone-200">{tpl.label}</p>
                    <p className="truncate text-xs text-stone-500 dark:text-stone-400">
                      {tpl.description}
                      {tpl.payee ? ` · ${tpl.payee}` : ''}
                    </p>
                  </div>
                  <div className="ml-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleQuickEdit(tpl)}
                      className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleQuickDelete(tpl.id)}
                      disabled={quickSaving}
                      className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-stone-800 dark:text-red-400 dark:hover:bg-red-950"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="mt-5 space-y-3 rounded-xl border border-stone-200/60 bg-stone-50/40 p-4 dark:border-stone-700/60 dark:bg-stone-900/30">
            <p className="text-sm font-semibold text-stone-800 dark:text-stone-200">
              {quickForm.id ? 'Edit Quick Template' : 'New Quick Template'}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                value={quickForm.label}
                onChange={(e) => setQuickForm((prev) => ({ ...prev, label: e.target.value }))}
                placeholder="Button label (e.g. Grocery Run)"
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              />
              <select
                value={quickForm.is_income ? 'income' : 'expense'}
                onChange={(e) => setQuickForm((prev) => ({ ...prev, is_income: e.target.value === 'income' }))}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </div>

            <input
              type="text"
              value={quickForm.description}
              onChange={(e) => setQuickForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Description"
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />
            <input
              type="text"
              value={quickForm.payee}
              onChange={(e) => setQuickForm((prev) => ({ ...prev, payee: e.target.value }))}
              placeholder="Payee (optional)"
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
            />

            <div className="grid grid-cols-2 gap-3">
              <select
                value={quickForm.account_id}
                onChange={(e) => setQuickForm((prev) => ({ ...prev, account_id: e.target.value }))}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              >
                <option value="">Select account…</option>
                {openAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                ))}
              </select>

              <select
                value={quickForm.category_id}
                onChange={(e) => setQuickForm((prev) => ({ ...prev, category_id: e.target.value }))}
                className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              >
                <option value="">Select category…</option>
                {Object.entries(groupedQuickCategories).map(([type, items]) => (
                  items.length > 0 ? (
                    <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                      {items.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </optgroup>
                  ) : null
                ))}
              </select>
            </div>

            {partnership && (
              <div className="rounded-xl border border-stone-200/60 bg-white px-3 py-3 dark:border-stone-700/60 dark:bg-stone-800/70">
                <div className="mb-2 flex items-center gap-2">
                  <input
                    id="quickSplitToggle"
                    type="checkbox"
                    checked={quickForm.is_split}
                    onChange={(e) => setQuickForm((prev) => ({ ...prev, is_split: e.target.checked }))}
                  />
                  <label htmlFor="quickSplitToggle" className="text-sm font-medium text-stone-700 dark:text-stone-300">
                    Auto-create split expense
                  </label>
                </div>
                {quickForm.is_split && (
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={quickForm.split_method}
                      onChange={(e) => setQuickForm((prev) => ({ ...prev, split_method: e.target.value }))}
                      className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                    >
                      <option value="equal">50/50</option>
                      <option value="full">100% owed</option>
                      <option value="custom">Custom %</option>
                    </select>
                    <select
                      value={quickForm.split_payer}
                      onChange={(e) => setQuickForm((prev) => ({ ...prev, split_payer: e.target.value }))}
                      className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-900 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                    >
                      <option value="me">Paid by me</option>
                      <option value="partner">Paid by partner</option>
                    </select>
                    <input
                      type="number"
                      min="1"
                      max="99"
                      value={quickForm.split_method === 'custom' ? quickForm.split_partner_share_pct : ''}
                      onChange={(e) => setQuickForm((prev) => ({ ...prev, split_partner_share_pct: Number(e.target.value || 0) }))}
                      disabled={quickForm.split_method !== 'custom'}
                      placeholder="Partner %"
                      className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-sm text-stone-900 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleQuickSave}
                disabled={quickSaving}
                className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50"
              >
                {quickForm.id ? 'Update template' : 'Add template'}
              </button>
              {quickForm.id && (
                <button
                  type="button"
                  onClick={resetQuickForm}
                  className="rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  Cancel edit
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Budget Thresholds ────────────────────────── */}
        {isLoading ? (
          <div className="h-64 animate-pulse rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" />
        ) : (
          <div className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
            <h2 className="mb-1 text-lg font-semibold text-stone-900 dark:text-stone-100">Budget Thresholds</h2>
            <p className="mb-6 text-sm text-stone-500 dark:text-stone-400">
              Control when categories are highlighted as <span className="font-medium text-emerald-600">under budget</span>, <span className="font-medium text-amber-600">warning</span>, or <span className="font-medium text-red-600">danger</span> based on the percentage of budget used.
            </p>

            {(loadError || saveStatus === 'error') && (
              <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
                <span className="mr-1.5">⚠</span>
                {loadError || 'Failed to save. Please try again.'}
              </div>
            )}

            {saveStatus === 'success' && (
              <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
                <span className="mr-1.5">✓</span>Thresholds saved successfully.
              </div>
            )}

            {validationError && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
                <span className="mr-1.5">⚠</span>{validationError}
              </div>
            )}

            <div className="space-y-3">
              {/* Under budget threshold */}
              <div className="flex items-center gap-3">
                <div className="flex flex-1 items-center gap-2">
                  <label htmlFor="underBudgetThreshold" className="flex items-center gap-2 text-sm font-medium text-emerald-600">
                    <span className="text-base">🟢</span>
                    <span>Under budget</span>
                  </label>
                  <span tabIndex={0} role="button" aria-label="More info" className="group relative inline-block focus:outline-none">
                    <svg className="h-4 w-4 cursor-pointer text-stone-400 hover:text-stone-600 dark:hover:text-stone-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                    <span className="invisible group-hover:visible group-focus:visible pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-xl bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 shadow-lg dark:bg-stone-700">
                      Categories below this percentage show a green highlight. Default: {DEFAULT_THRESHOLDS.underBudget}%
                      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-stone-800 dark:border-t-stone-700" />
                    </span>
                  </span>
                </div>
                <div className="relative shrink-0">
                  <input
                    id="underBudgetThreshold"
                    type="number"
                    min="1"
                    max="999"
                    step="1"
                    value={displayUnderBudget}
                    onChange={(e) => {
                      setUnderBudgetInput(e.target.value === '' ? '' : Number(e.target.value));
                      setValidationError('');
                      setSaveStatus('');
                    }}
                    className="w-20 rounded-xl border border-stone-200 bg-white px-3 py-2 pr-7 text-sm text-stone-900 shadow-sm transition-all focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:border-emerald-500"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">%</span>
                </div>
              </div>

              {/* Warning threshold */}
              <div className="flex items-center gap-3">
                <div className="flex flex-1 items-center gap-2">
                  <label htmlFor="warningThreshold" className="flex items-center gap-2 text-sm font-medium text-amber-600">
                    <span className="text-base">⚠️</span>
                    <span>Warning</span>
                  </label>
                  <span tabIndex={0} role="button" aria-label="More info" className="group relative inline-block focus:outline-none">
                    <svg className="h-4 w-4 cursor-pointer text-stone-400 hover:text-stone-600 dark:hover:text-stone-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                    <span className="invisible group-hover:visible group-focus:visible pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-xl bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 shadow-lg dark:bg-stone-700">
                      Categories at or above this percentage show an amber warning. Default: {DEFAULT_THRESHOLDS.warning}%
                      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-stone-800 dark:border-t-stone-700" />
                    </span>
                  </span>
                </div>
                <div className="relative shrink-0">
                  <input
                    id="warningThreshold"
                    type="number"
                    min="1"
                    max="999"
                    step="1"
                    value={displayWarning}
                    onChange={(e) => {
                      setWarningInput(e.target.value === '' ? '' : Number(e.target.value));
                      setValidationError('');
                      setSaveStatus('');
                    }}
                    className="w-20 rounded-xl border border-stone-200 bg-white px-3 py-2 pr-7 text-sm text-stone-900 shadow-sm transition-all focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/30 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:border-amber-500"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">%</span>
                </div>
              </div>

              {/* Danger threshold */}
              <div className="flex items-center gap-3">
                <div className="flex flex-1 items-center gap-2">
                  <label htmlFor="dangerThreshold" className="flex items-center gap-2 text-sm font-medium text-red-600">
                    <span className="text-base">🔴</span>
                    <span>Danger</span>
                  </label>
                  <span tabIndex={0} role="button" aria-label="More info" className="group relative inline-block focus:outline-none">
                    <svg className="h-4 w-4 cursor-pointer text-stone-400 hover:text-stone-600 dark:hover:text-stone-300" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                    <span className="invisible group-hover:visible group-focus:visible pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-xl bg-stone-800 px-3 py-2 text-xs font-normal text-stone-100 shadow-lg dark:bg-stone-700">
                      Categories at or above this percentage show a red danger alert. Default: {DEFAULT_THRESHOLDS.danger}%
                      <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-stone-800 dark:border-t-stone-700" />
                    </span>
                  </span>
                </div>
                <div className="relative shrink-0">
                  <input
                    id="dangerThreshold"
                    type="number"
                    min="1"
                    max="999"
                    step="1"
                    value={displayDanger}
                    onChange={(e) => {
                      setDangerInput(e.target.value === '' ? '' : Number(e.target.value));
                      setValidationError('');
                      setSaveStatus('');
                    }}
                    className="w-20 rounded-xl border border-stone-200 bg-white px-3 py-2 pr-7 text-sm text-stone-900 shadow-sm transition-all focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/30 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:border-red-500"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">%</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:shadow-lg hover:shadow-amber-200/60 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSaving ? 'Saving…' : 'Save thresholds'}
              </button>

              {!isDefault && (
                <button
                  type="button"
                  onClick={handleReset}
                  disabled={isSaving}
                  className="rounded-xl border border-stone-200 bg-white px-5 py-2.5 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                >
                  Reset to defaults
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Manage Categories ─────────────────────── */}
        <div className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
          <h2 className="mb-1 text-lg font-semibold text-stone-900 dark:text-stone-100">Manage Categories</h2>
          <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">Create and manage your spending categories.</p>
          <Link
            to="/app/categories"
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/60 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:focus:ring-offset-stone-800"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
            </svg>
            Go to Categories
          </Link>
        </div>

        </div>{/* end left column */}

        {/* ── Right column: Export Data + Import Data ── */}
        <div className="flex flex-col gap-6">

        {/* ── Export Data ──────────────────────────────── */}
        <div className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
          <h2 className="mb-1 text-lg font-semibold text-stone-900 dark:text-stone-100">Export Data</h2>
          <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
            Download your data for backup or analysis.
          </p>
          <ExportData />
        </div>

        {/* ── Import Data ──────────────────────────────── */}
        <div className="animate-fade-in-up rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
          <h2 className="mb-1 text-lg font-semibold text-stone-900 dark:text-stone-100">Import Data</h2>
          <p className="mb-5 text-sm text-stone-500 dark:text-stone-400">
            Bulk-import transactions or budgets from a CSV or Excel file.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/60 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Import Transactions
            </button>
            <button
              type="button"
              onClick={() => setShowBudgetImportModal(true)}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/60 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              Import Budget
            </button>
          </div>
        </div>

        </div>{/* end right column */}

        </div>{/* end Row 2 */}
      </div>

      {/* Import CSV/Excel modal */}
      {showImportModal && (
        <div data-modal-open="true" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-2xl border border-stone-200/60 bg-white p-6 shadow-2xl shadow-stone-900/10 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">Import Transactions</h2>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <ImportCSV
              categories={categories}
              accounts={accounts}
              onComplete={() => {}}
              onClose={() => setShowImportModal(false)}
            />
          </div>
        </div>
      )}

      {/* Import Budget CSV modal */}
      {showBudgetImportModal && (
        <BudgetImportModal
          categories={categories}
          onClose={() => setShowBudgetImportModal(false)}
          onImportComplete={() => setShowBudgetImportModal(false)}
        />
      )}
    </div>
  );
}
