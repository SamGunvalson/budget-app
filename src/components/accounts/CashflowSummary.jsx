import { useState } from 'react';
import { formatCurrency, maskAccountName, toCents, toDollars } from '../../utils/helpers';

const SHORT_MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  return `${SHORT_MONTHS[Number(m)]} ${Number(d)}`;
}

function signed(cents) {
  return `${cents < 0 ? '−' : ''}${formatCurrency(Math.abs(cents))}`;
}

/**
 * CashflowSummary — the answer to "can I afford it?" for the current scenario.
 *
 * Props:
 *  - summary: buildCashflowScenario().summary
 *  - hasItems: whether any test items are switched on
 *  - unsetCards: card accounts without a usable statement cycle
 *  - onCushionChange(cents): save a new safety cushion
 *  - onManageAccounts(): open Manage Accounts to finish card setup
 */
export default function CashflowSummary({ summary, hasItems, unsetCards = [], onCushionChange, onManageAccounts }) {
  const [editingCushion, setEditingCushion] = useState(false);
  const [cushionInput, setCushionInput] = useState('');

  if (!summary?.lowest) return null;
  const { lowest, baselineLowest, impact, headroom, belowCushion, cushion, endCardDebt } = summary;

  function startEdit() {
    // raw: this is edited and saved back, so never the safe-mode number.
    setCushionInput(cushion ? String(toDollars(cushion, { raw: true })) : '');
    setEditingCushion(true);
  }

  function saveCushion() {
    const dollars = parseFloat(cushionInput);
    const cents = Number.isFinite(dollars) && dollars > 0 ? toCents(dollars) : 0;
    onCushionChange?.(cents);
    setEditingCushion(false);
  }

  const tone = belowCushion
    ? 'border-red-200 bg-red-50/80 dark:border-red-800/60 dark:bg-red-950/40'
    : 'border-emerald-200/60 bg-emerald-50/60 dark:border-emerald-800/40 dark:bg-emerald-950/30';

  return (
    <div className={`mb-6 rounded-2xl border px-5 py-4 shadow-sm ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-sm font-semibold ${belowCushion ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {belowCushion
              ? `${hasItems ? 'With these purchases, cash' : 'Cash'} drops below your cushion`
              : `${hasItems ? 'You can cover these purchases' : 'Cash stays above your cushion'}`}
          </p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-stone-900 dark:text-stone-100">
            Lowest cash {signed(lowest.amount)}
            <span className="ml-2 text-sm font-medium text-stone-500 dark:text-stone-400">on {formatShortDate(lowest.date)}</span>
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            After card statements are paid from their accounts.
            {hasItems && baselineLowest && impact !== 0 && (
              <> Without the test items: {signed(baselineLowest.amount)} ({impact < 0 ? '−' : '+'}{formatCurrency(Math.abs(impact))}).</>
            )}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-right sm:grid-cols-3">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Room above cushion</dt>
            <dd className={`text-lg font-bold ${headroom < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {signed(headroom)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Cushion</dt>
            <dd className="text-lg font-bold text-stone-700 dark:text-stone-200">
              {editingCushion ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    autoFocus
                    aria-label="Safety cushion in dollars"
                    value={cushionInput}
                    onChange={(e) => setCushionInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') saveCushion(); if (e.key === 'Escape') setEditingCushion(false); }}
                    className="w-24 rounded-lg border border-stone-200/80 bg-white px-2 py-1 text-right text-sm text-stone-800 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-500/30 dark:border-stone-700/60 dark:bg-stone-800 dark:text-stone-200"
                  />
                  <button type="button" onClick={saveCushion} className="rounded-md bg-amber-500 px-2 py-1 text-xs font-semibold text-stone-950 hover:bg-amber-600">Save</button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={startEdit}
                  title="Edit the minimum cash you want to keep"
                  className="underline decoration-dotted underline-offset-4 hover:text-amber-600 dark:hover:text-amber-400"
                >
                  {formatCurrency(cushion)}
                </button>
              )}
            </dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">Card debt at end</dt>
            <dd className="text-lg font-bold text-stone-700 dark:text-stone-200">{formatCurrency(Math.max(0, endCardDebt ?? 0))}</dd>
          </div>
        </dl>
      </div>

      {unsetCards.length > 0 && (
        <p className="mt-3 border-t border-stone-200/60 pt-3 text-xs text-stone-500 dark:border-stone-700/60 dark:text-stone-400">
          {unsetCards.length === 1
            ? `${maskAccountName(unsetCards[0].name)} has no statement cycle, so its charges aren't paid from cash in this forecast.`
            : `${unsetCards.length} cards have no statement cycle, so their charges aren't paid from cash in this forecast.`}{' '}
          <button type="button" onClick={onManageAccounts} className="font-medium text-amber-600 hover:underline dark:text-amber-400">
            Set up in Manage Accounts
          </button>
        </p>
      )}
    </div>
  );
}
