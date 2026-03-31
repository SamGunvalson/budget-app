import { useState, useMemo, useCallback } from 'react';
import { formatCurrency, maskAccountName, toCents } from '../../utils/helpers';
import { getUserPreference, setUserPreference } from '../../services/categories';

const MAX_SCENARIOS = 10;

/**
 * SpendingPlayground — scratchpad for experimenting with hypothetical
 * expenses, income, and inter-account transfers.
 *
 * Props:
 *  - accounts: Array<{ id, name, type, balance, is_asset }>
 */
export default function SpendingPlayground({ accounts = [] }) {
  // ── Scenario management ─────────────────────────────────────────────
  const [scenarios, setScenarios] = useState([]);
  const [scenarioName, setScenarioName] = useState('');
  const [scenariosLoaded, setScenariosLoaded] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);

  // Load scenarios lazily
  const loadScenarios = useCallback(async () => {
    if (scenariosLoaded) return;
    try {
      const saved = await getUserPreference('playground_scenarios');
      if (Array.isArray(saved)) setScenarios(saved);
    } catch {
      // ignore
    }
    setScenariosLoaded(true);
  }, [scenariosLoaded]);

  // Load on first render
  useState(() => { loadScenarios(); });

  // ── Items state ─────────────────────────────────────────────────────
  const [items, setItems] = useState([]);
  // item: { id, type: 'expense'|'income'|'transfer', description, amount, accountId, toAccountId? }
  const [nextId, setNextId] = useState(1);

  // ── Snapshot of current balances ────────────────────────────────────
  const baseBalances = useMemo(() => {
    const m = {};
    for (const a of accounts) m[a.id] = a.balance;
    return m;
  }, [accounts]);

  // ── Compute remaining ──────────────────────────────────────────────
  const remainders = useMemo(() => {
    const r = { ...baseBalances };
    for (const item of items) {
      const cents = toCents(item.amount || 0);
      if (item.type === 'expense' && item.accountId) {
        const acct = accounts.find((a) => a.id === item.accountId);
        if (acct) r[item.accountId] += acct.is_asset ? -cents : cents;
      } else if (item.type === 'income' && item.accountId) {
        const acct = accounts.find((a) => a.id === item.accountId);
        if (acct) r[item.accountId] += acct.is_asset ? cents : -cents;
      } else if (item.type === 'transfer' && item.accountId && item.toAccountId) {
        const from = accounts.find((a) => a.id === item.accountId);
        const to = accounts.find((a) => a.id === item.toAccountId);
        if (from) r[item.accountId] += from.is_asset ? -cents : cents;
        if (to) r[item.toAccountId] += to.is_asset ? cents : -cents;
      }
    }
    return r;
  }, [baseBalances, items, accounts]);

  const grandTotal = useMemo(
    () => accounts.reduce((s, acct) => {
      const r = remainders[acct.id] ?? 0;
      return s + (acct.is_asset ? r : -r);
    }, 0),
    [remainders, accounts],
  );
  const baseTotalBalance = useMemo(
    () => accounts.reduce((s, acct) => {
      const b = baseBalances[acct.id] ?? 0;
      return s + (acct.is_asset ? b : -b);
    }, 0),
    [baseBalances, accounts],
  );

  // ── Actions ─────────────────────────────────────────────────────────
  function addItem(type) {
    setItems((prev) => [...prev, {
      id: nextId,
      type,
      description: '',
      amount: '',
      accountId: accounts[0]?.id || '',
      toAccountId: type === 'transfer' ? (accounts[1]?.id || accounts[0]?.id || '') : '',
    }]);
    setNextId((n) => n + 1);
  }

  function updateItem(id, field, value) {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, [field]: value } : item));
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function resetPlayground() {
    setItems([]);
    setNextId(1);
  }

  async function saveScenario() {
    if (!scenarioName.trim()) return;
    const scenario = {
      name: scenarioName.trim(),
      items: items.map((i) => ({ ...i })),
      savedAt: new Date().toISOString(),
    };
    const updated = [...scenarios, scenario].slice(-MAX_SCENARIOS);
    setScenarios(updated);
    setScenarioName('');
    setShowSaveInput(false);
    await setUserPreference('playground_scenarios', updated).catch(() => {});
  }

  function loadScenarioByIndex(idx) {
    const s = scenarios[idx];
    if (!s) return;
    setItems(s.items.map((item, i) => ({ ...item, id: i + 1 })));
    setNextId(s.items.length + 1);
  }

  async function deleteScenario(idx) {
    const updated = scenarios.filter((_, i) => i !== idx);
    setScenarios(updated);
    await setUserPreference('playground_scenarios', updated).catch(() => {});
  }

  function colorForAmount(cents) {
    if (cents > 0) return 'text-emerald-600 dark:text-emerald-400';
    if (cents < 0) return 'text-red-600 dark:text-red-400';
    return 'text-stone-600 dark:text-stone-400';
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Spending Playground
          </p>
          <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
            Experiment with hypothetical expenses, income, and transfers to see how your balances change.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Load scenario */}
          {scenarios.length > 0 && (
            <select
              onChange={(e) => { if (e.target.value !== '') loadScenarioByIndex(Number(e.target.value)); e.target.value = ''; }}
              defaultValue=""
              className="rounded-lg border border-stone-200/80 bg-stone-50/80 px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-300"
            >
              <option value="">Load scenario…</option>
              {scenarios.map((s, i) => (
                <option key={i} value={i}>{s.name}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={resetPlayground}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-700/40"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Account balance snapshot */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.filter((a) => !a.closed_at).map((acct) => {
          const base = baseBalances[acct.id] ?? 0;
          const remaining = remainders[acct.id] ?? 0;
          const rawDiff = remaining - base;
          // For display: negate liability values so debt shows as negative/red
          const displayBase = acct.is_asset ? base : -base;
          const displayRemaining = acct.is_asset ? remaining : -remaining;
          const displayDiff = acct.is_asset ? rawDiff : -rawDiff;
          return (
            <div
              key={acct.id}
              className="flex items-center justify-between rounded-xl border border-stone-200/60 bg-white/60 px-4 py-2.5 shadow-sm dark:border-stone-700/60 dark:bg-stone-800/60"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-stone-700 dark:text-stone-200">
                  {maskAccountName(acct.name)}
                </p>
                <p className="text-[10px] text-stone-400">
                  Start: {displayBase < 0 ? '−' : ''}{formatCurrency(Math.abs(displayBase))}
                  {displayDiff !== 0 && (
                    <span className={`ml-1 ${colorForAmount(displayDiff)}`}>
                      ({displayDiff > 0 ? '+' : '−'}{formatCurrency(Math.abs(displayDiff))})
                    </span>
                  )}
                </p>
              </div>
              <p className={`text-base font-extrabold ${colorForAmount(displayRemaining)}`}>
                {displayRemaining < 0 ? '−' : ''}{formatCurrency(Math.abs(displayRemaining))}
              </p>
            </div>
          );
        })}
      </div>

      {/* Grand total */}
      <div className="flex items-center justify-between rounded-xl border border-teal-200/60 bg-teal-50/40 px-5 py-3 dark:border-teal-800/40 dark:bg-teal-900/20">
        <span className="text-sm font-semibold text-teal-700 dark:text-teal-300">Total Remaining</span>
        <div className="text-right">
          <p className={`text-xl font-extrabold ${colorForAmount(grandTotal)}`}>
            {grandTotal < 0 ? '−' : ''}{formatCurrency(Math.abs(grandTotal))}
          </p>
          {grandTotal !== baseTotalBalance && (
            <p className={`text-[10px] ${colorForAmount(grandTotal - baseTotalBalance)}`}>
              {grandTotal - baseTotalBalance > 0 ? '+' : '−'}{formatCurrency(Math.abs(grandTotal - baseTotalBalance))} from start
            </p>
          )}
        </div>
      </div>

      {/* Items list */}
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200/60 bg-white/60 px-4 py-2.5 shadow-sm dark:border-stone-700/60 dark:bg-stone-800/60"
          >
            {/* Type badge */}
            <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              item.type === 'expense' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400' :
              item.type === 'income' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
              'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
            }`}>
              {item.type}
            </span>

            {/* Description */}
            <input
              type="text"
              value={item.description}
              onChange={(e) => updateItem(item.id, 'description', e.target.value)}
              placeholder="Description"
              className="min-w-0 flex-1 rounded-lg border border-stone-200/80 bg-stone-50/80 px-2.5 py-1.5 text-sm text-stone-800 placeholder-stone-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-200 dark:placeholder-stone-500"
            />

            {/* Amount */}
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={item.amount}
                onChange={(e) => updateItem(item.id, 'amount', e.target.value)}
                placeholder="0.00"
                className="w-28 rounded-lg border border-stone-200/80 bg-stone-50/80 py-1.5 pl-6 pr-2 text-sm text-stone-800 placeholder-stone-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-200 dark:placeholder-stone-500"
              />
            </div>

            {/* From account */}
            <select
              value={item.accountId}
              onChange={(e) => updateItem(item.id, 'accountId', e.target.value)}
              className="rounded-lg border border-stone-200/80 bg-stone-50/80 px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-300"
            >
              <option value="">{item.type === 'transfer' ? 'From…' : 'Account…'}</option>
              {accounts.filter((a) => !a.closed_at).map((a) => (
                <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
              ))}
            </select>

            {/* To account (transfers only) */}
            {item.type === 'transfer' && (
              <>
                <span className="text-xs text-stone-400">→</span>
                <select
                  value={item.toAccountId}
                  onChange={(e) => updateItem(item.id, 'toAccountId', e.target.value)}
                  className="rounded-lg border border-stone-200/80 bg-stone-50/80 px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-300"
                >
                  <option value="">To…</option>
                  {accounts.filter((a) => !a.closed_at && a.id !== item.accountId).map((a) => (
                    <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                  ))}
                </select>
              </>
            )}

            {/* Remove */}
            <button
              type="button"
              onClick={() => removeItem(item.id)}
              className="shrink-0 rounded-md p-1 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Add buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => addItem('expense')}
          className="flex items-center gap-1.5 rounded-xl border border-red-200/60 bg-red-50/60 px-4 py-2 text-xs font-semibold text-red-700 transition-colors hover:bg-red-100 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Expense
        </button>
        <button
          type="button"
          onClick={() => addItem('income')}
          className="flex items-center gap-1.5 rounded-xl border border-emerald-200/60 bg-emerald-50/60 px-4 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Income
        </button>
        <button
          type="button"
          onClick={() => addItem('transfer')}
          className="flex items-center gap-1.5 rounded-xl border border-blue-200/60 bg-blue-50/60 px-4 py-2 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
          Transfer
        </button>

        {/* Save scenario */}
        <div className="ml-auto flex items-center gap-2">
          {showSaveInput ? (
            <>
              <input
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="Scenario name"
                maxLength={50}
                className="w-40 rounded-lg border border-stone-200/80 bg-stone-50/80 px-2.5 py-1.5 text-xs text-stone-800 placeholder-stone-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-200"
                onKeyDown={(e) => { if (e.key === 'Enter') saveScenario(); }}
              />
              <button
                type="button"
                onClick={saveScenario}
                disabled={!scenarioName.trim() || !items.length}
                className="rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-teal-600 disabled:opacity-40"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setShowSaveInput(false); setScenarioName(''); }}
                className="text-xs text-stone-400 hover:text-stone-600 dark:hover:text-stone-300"
              >
                Cancel
              </button>
            </>
          ) : (
            items.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSaveInput(true)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-teal-600 transition-colors hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-900/30"
              >
                Save Scenario
              </button>
            )
          )}
        </div>
      </div>

      {/* Saved scenarios list */}
      {scenarios.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Saved Scenarios
          </p>
          <div className="flex flex-wrap gap-2">
            {scenarios.map((s, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-lg border border-stone-200/60 bg-stone-50/60 px-3 py-1.5 dark:border-stone-700/60 dark:bg-stone-800/40"
              >
                <button
                  type="button"
                  onClick={() => loadScenarioByIndex(i)}
                  className="text-xs font-medium text-stone-700 transition-colors hover:text-teal-600 dark:text-stone-300 dark:hover:text-teal-400"
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteScenario(i)}
                  className="rounded p-0.5 text-stone-400 transition-colors hover:text-red-500"
                >
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
