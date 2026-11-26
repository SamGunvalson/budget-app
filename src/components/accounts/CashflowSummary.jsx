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

  // Healthy outlook = forest summary card; below the cushion = red warning card.
  const ok = !belowCushion;
  const tone = ok
    ? 'border-transparent bg-forest text-[#fbfcf2] shadow-lg shadow-stone-900/10'
    : 'border-red-200 bg-red-50/80 shadow-sm dark:border-red-800/60 dark:bg-red-950/40';
  const muted = ok ? 'text-[#d8e9d8]' : 'text-stone-500 dark:text-stone-400';
  const strong = ok ? 'text-[#fbfcf2]' : 'text-stone-700 dark:text-stone-200';

  return (
    <div className={`mb-6 rounded-2xl border px-6 py-5 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${belowCushion ? 'text-red-700 dark:text-red-400' : 'text-[#d8e9d8]'}`}>
            {belowCushion
              ? `${hasItems ? 'With these purchases, cash' : 'Cash'} drops below your cushion`
              : `${hasItems ? 'You can cover these purchases' : 'Cash stays above your cushion'}`}
          </p>
          <p className={`mt-1.5 font-display text-3xl font-normal tracking-tight sm:text-4xl ${ok ? 'text-[#fbfcf2]' : 'text-stone-900 dark:text-stone-100'}`}>
            Lowest cash {signed(lowest.amount)}
            <span className={`ml-2 font-sans text-sm font-medium ${muted}`}>on {formatShortDate(lowest.date)}</span>
          </p>
          <p className={`mt-1 text-xs ${muted}`}>
            After card statements are paid from their accounts.
            {hasItems && baselineLowest && impact !== 0 && (
              <> Without the test items: {signed(baselineLowest.amount)} ({impact < 0 ? '−' : '+'}{formatCurrency(Math.abs(impact))}).</>
            )}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-right sm:grid-cols-3">
          <div>
            <dt className={`text-[10px] font-semibold uppercase tracking-wider ${muted}`}>Room above cushion</dt>
            <dd className={`text-lg font-bold ${headroom < 0 ? 'text-red-600 dark:text-red-400' : ok ? 'text-[#b8d9ac]' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {signed(headroom)}
            </dd>
          </div>
          <div>
            <dt className={`text-[10px] font-semibold uppercase tracking-wider ${muted}`}>Cushion</dt>
            <dd className={`text-lg font-bold ${strong}`}>
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
                  className={`underline decoration-dotted underline-offset-4 ${ok ? 'hover:text-[#e7c985]' : 'hover:text-amber-600 dark:hover:text-amber-400'}`}
                >
                  {formatCurrency(cushion)}
                </button>
              )}
            </dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className={`text-[10px] font-semibold uppercase tracking-wider ${muted}`}>Card debt at end</dt>
            <dd className={`text-lg font-bold ${strong}`}>{formatCurrency(Math.max(0, endCardDebt ?? 0))}</dd>
          </div>
        </dl>
      </div>

      {unsetCards.length > 0 && (
        <p className={`mt-3 border-t pt-3 text-xs ${ok ? 'border-white/15 text-[#daeadc]' : 'border-stone-200/60 text-stone-500 dark:border-stone-700/60 dark:text-stone-400'}`}>
          {unsetCards.length === 1
            ? `${maskAccountName(unsetCards[0].name)} has no statement cycle, so its charges aren't paid from cash in this forecast.`
            : `${unsetCards.length} cards have no statement cycle, so their charges aren't paid from cash in this forecast.`}{' '}
          <button type="button" onClick={onManageAccounts} className={`font-medium hover:underline ${ok ? 'text-[#e7c985]' : 'text-amber-700 dark:text-amber-400'}`}>
            Set up in Manage Accounts
          </button>
        </p>
      )}
    </div>
  );
}
