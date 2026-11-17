import { useState } from 'react';
import { maskAccountName, toDateString } from '../../utils/helpers';
import { newId } from '../../utils/ids';
import { useUserPreference } from '../../hooks/queries';
import { setUserPreferenceOffline } from '../../services/offlineAware';

const MAX_SCENARIOS = 10;
const SCENARIOS_KEY = 'playground_scenarios';
const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatShortDate(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${SHORT_MONTHS[Number(m)]} ${Number(d)}`;
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return toDateString(d);
}

const inputCls = 'rounded-lg border border-stone-200/80 bg-stone-50/80 text-stone-800 placeholder-stone-400 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/30 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-200 dark:placeholder-stone-500';
const selectCls = 'rounded-lg border border-stone-200/80 bg-stone-50/80 px-2 py-1.5 text-xs text-stone-700 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-300';

function SettlementNote({ info, accountMap }) {
  if (!info) return null;
  const payer = maskAccountName(accountMap[info.payerId]?.name || 'account');
  if (info.status === 'settles') {
    return <>→ statement closes {formatShortDate(info.closeDate)}, paid from {payer} on {formatShortDate(info.paymentDate)}</>;
  }
  if (info.status === 'after-range') {
    return <>→ statement closes {formatShortDate(info.closeDate)}, paid from {payer} on {formatShortDate(info.dueDate)} (after the chart range)</>;
  }
  return <>→ this card has no statement cycle, so the charge isn&apos;t paid from cash</>;
}

/**
 * TestTransactions — hypothetical expenses, income, and transfers layered on
 * the forecast. Controlled: the page owns `items` so they survive collapsing
 * this panel and switching tabs.
 *
 * item: { id, enabled, type: 'expense'|'income'|'transfer', description,
 *         amount (dollars, as typed), accountId, toAccountId, date }
 *
 * Props:
 *  - accounts: open accounts
 *  - items, onItemsChange(next)
 *  - settlementInfo: { [itemId]: itemSettlementInfo() result }
 */
export default function TestTransactions({ accounts = [], items = [], onItemsChange, settlementInfo = {} }) {
  const scenariosQuery = useUserPreference(SCENARIOS_KEY);
  const scenarios = Array.isArray(scenariosQuery.data) ? scenariosQuery.data : [];
  const [scenarioName, setScenarioName] = useState('');
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveError, setSaveError] = useState('');

  const accountMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const firstCard = accounts.find((a) => a.type === 'credit_card');

  const setItems = (updater) => onItemsChange?.(typeof updater === 'function' ? updater(items) : updater);

  function addItem(type) {
    const defaultAccount = type === 'expense' ? (firstCard || accounts[0]) : accounts[0];
    const toAccount = accounts.find((a) => a.id !== defaultAccount?.id);
    setItems((prev) => [...prev, {
      id: newId(),
      enabled: true,
      type,
      description: '',
      amount: '',
      accountId: defaultAccount?.id || '',
      toAccountId: type === 'transfer' ? (toAccount?.id || '') : '',
      date: tomorrowISO(),
    }]);
  }

  function updateItem(id, field, value) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  // Add a sibling charge with the same description/date on the next card, so
  // one purchase can be spread across cards.
  function splitItem(item) {
    const cards = accounts.filter((a) => a.type === 'credit_card');
    const pool = cards.length > 1 ? cards : accounts;
    const idx = pool.findIndex((a) => a.id === item.accountId);
    const next = pool[(idx + 1) % pool.length] || pool[0];
    setItems((prev) => {
      const at = prev.findIndex((i) => i.id === item.id);
      const copy = { ...item, id: newId(), amount: '', accountId: next?.id || item.accountId, enabled: true };
      return [...prev.slice(0, at + 1), copy, ...prev.slice(at + 1)];
    });
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  async function writeScenarios(next) {
    setSaveError('');
    try {
      await setUserPreferenceOffline(SCENARIOS_KEY, next);
    } catch (err) {
      setSaveError(err?.message || 'Could not save scenarios.');
    }
  }

  async function saveScenario() {
    if (!scenarioName.trim() || !items.length) return;
    const scenario = {
      name: scenarioName.trim(),
      items: items.map((i) => ({ ...i })),
      savedAt: new Date().toISOString(),
    };
    setScenarioName('');
    setShowSaveInput(false);
    await writeScenarios([...scenarios, scenario].slice(-MAX_SCENARIOS));
  }

  function loadScenario(idx) {
    const s = scenarios[idx];
    if (!s) return;
    // Older saves have numeric ids and no `enabled`; normalize both.
    setItems(s.items.map((item) => ({ date: tomorrowISO(), enabled: true, ...item, id: newId() })));
  }

  async function deleteScenario(idx) {
    await writeScenarios(scenarios.filter((_, i) => i !== idx));
  }

  const enabledCount = items.filter((i) => i.enabled !== false).length;

  return (
    <div className="space-y-4 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-stone-400 dark:text-stone-500">
          Add purchases, income, or transfers to see where they leave you. Card charges are paid
          from the card&apos;s paying account when its statement comes due.
        </p>
        {items.length > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setItems((prev) => prev.map((i) => ({ ...i, enabled: enabledCount === 0 })))}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-700/40"
            >
              {enabledCount === 0 ? 'Turn all on' : 'Turn all off'}
            </button>
            <button
              type="button"
              onClick={() => setItems([])}
              className="rounded-lg px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-700/40"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          {items.map((item) => {
            const on = item.enabled !== false;
            return (
              <div
                key={item.id}
                className={`rounded-xl border border-stone-200/60 bg-white/60 px-4 py-2.5 shadow-sm transition-opacity dark:border-stone-700/60 dark:bg-stone-800/60 ${on ? '' : 'opacity-50'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) => updateItem(item.id, 'enabled', e.target.checked)}
                    aria-label={on ? 'Exclude from forecast' : 'Include in forecast'}
                    title={on ? 'Included in the forecast' : 'Excluded from the forecast'}
                    className="h-4 w-4 shrink-0 rounded border-stone-300 text-teal-600 focus:ring-teal-500 dark:border-stone-600 dark:bg-stone-700"
                  />
                  <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    item.type === 'expense' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400'
                      : item.type === 'income' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
                        : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                  }`}>
                    {item.type}
                  </span>

                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                    placeholder="Description"
                    aria-label="Description"
                    className={`min-w-0 flex-1 px-2.5 py-1.5 text-sm ${inputCls}`}
                  />

                  <div className="relative">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={item.amount}
                      onChange={(e) => updateItem(item.id, 'amount', e.target.value)}
                      placeholder="0.00"
                      aria-label="Amount"
                      className={`w-28 py-1.5 pl-6 pr-2 text-sm ${inputCls}`}
                    />
                  </div>

                  <select
                    value={item.accountId}
                    onChange={(e) => updateItem(item.id, 'accountId', e.target.value)}
                    aria-label={item.type === 'transfer' ? 'From account' : 'Account'}
                    className={selectCls}
                  >
                    <option value="">{item.type === 'transfer' ? 'From…' : 'Account…'}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                    ))}
                  </select>

                  {item.type === 'transfer' && (
                    <>
                      <span className="text-xs text-stone-400">→</span>
                      <select
                        value={item.toAccountId}
                        onChange={(e) => updateItem(item.id, 'toAccountId', e.target.value)}
                        aria-label="To account"
                        className={selectCls}
                      >
                        <option value="">To…</option>
                        {accounts.filter((a) => a.id !== item.accountId).map((a) => (
                          <option key={a.id} value={a.id}>{maskAccountName(a.name)}</option>
                        ))}
                      </select>
                    </>
                  )}

                  <input
                    type="date"
                    value={item.date || ''}
                    onChange={(e) => updateItem(item.id, 'date', e.target.value)}
                    aria-label="Date"
                    className={`px-2 py-1.5 text-xs ${inputCls}`}
                  />

                  {item.type === 'expense' && (
                    <button
                      type="button"
                      onClick={() => splitItem(item)}
                      title="Put part of this purchase on another card"
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-stone-500 transition-colors hover:bg-stone-100 hover:text-teal-600 dark:text-stone-400 dark:hover:bg-stone-700/40 dark:hover:text-teal-400"
                    >
                      Split
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    aria-label="Remove"
                    className="shrink-0 rounded-md p-1 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {on && settlementInfo[item.id] && (
                  <p className="mt-1.5 pl-6 text-[11px] text-stone-400 dark:text-stone-500">
                    <SettlementNote info={settlementInfo[item.id]} accountMap={accountMap} />
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {[
          { type: 'expense', label: 'Expense', cls: 'border-red-200/60 bg-red-50/60 text-red-700 hover:bg-red-100 dark:border-red-800/40 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40' },
          { type: 'income', label: 'Income', cls: 'border-emerald-200/60 bg-emerald-50/60 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-900/20 dark:text-emerald-400 dark:hover:bg-emerald-900/40' },
          { type: 'transfer', label: 'Transfer', cls: 'border-blue-200/60 bg-blue-50/60 text-blue-700 hover:bg-blue-100 dark:border-blue-800/40 dark:bg-blue-900/20 dark:text-blue-400 dark:hover:bg-blue-900/40' },
        ].map((b) => (
          <button
            key={b.type}
            type="button"
            onClick={() => addItem(b.type)}
            className={`flex items-center gap-1.5 rounded-xl border px-4 py-2 text-xs font-semibold transition-colors ${b.cls}`}
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            {b.label}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {showSaveInput ? (
            <>
              <input
                type="text"
                value={scenarioName}
                onChange={(e) => setScenarioName(e.target.value)}
                placeholder="Scenario name"
                aria-label="Scenario name"
                maxLength={50}
                className={`w-40 px-2.5 py-1.5 text-xs ${inputCls}`}
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

      {saveError && <p className="text-xs text-red-500">{saveError}</p>}

      {scenarios.length > 0 && (
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Saved Scenarios
          </p>
          <div className="flex flex-wrap gap-2">
            {scenarios.map((s, i) => (
              <div
                key={`${s.name}-${s.savedAt}`}
                className="flex items-center gap-1.5 rounded-lg border border-stone-200/60 bg-stone-50/60 px-3 py-1.5 dark:border-stone-700/60 dark:bg-stone-800/40"
              >
                <button
                  type="button"
                  onClick={() => loadScenario(i)}
                  title="Replace the current items with this scenario"
                  className="text-xs font-medium text-stone-700 transition-colors hover:text-teal-600 dark:text-stone-300 dark:hover:text-teal-400"
                >
                  {s.name}
                </button>
                <button
                  type="button"
                  onClick={() => deleteScenario(i)}
                  aria-label={`Delete scenario ${s.name}`}
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
