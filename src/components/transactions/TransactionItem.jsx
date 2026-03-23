import { useState, useRef, useEffect, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency, formatDate, toCents, toDollars, maskAccountName } from '../../utils/helpers';
import { isAssetAccount, getAccountBadgeColor } from '../../services/accounts';

function TransactionStatusBadges({
  isProjected,
  isPending,
  isTransfer,
  isLinkedTransfer,
  effectiveIsIncome,
  splitTransactionIds,
  transactionId,
  compact = false,
}) {
  if (compact) {
    return (
      <>
        {isProjected && (
          <span title="Projected" className="inline-flex shrink-0 items-center">
            <svg className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </span>
        )}
        {isPending && (
          <span title="Pending" className="inline-flex shrink-0 items-center">
            <svg className="h-3.5 w-3.5 text-violet-500 dark:text-violet-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
            </svg>
          </span>
        )}
        {isTransfer && (
          <span title="Transfer" className="inline-flex shrink-0 items-center">
            <svg className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </span>
        )}
        {isLinkedTransfer && (
          <span
            title={effectiveIsIncome ? 'Linked transfer in (money received)' : 'Linked transfer out (money sent)'}
            className="inline-flex shrink-0 items-center"
          >
            <svg
              className={`h-3.5 w-3.5 ${effectiveIsIncome ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}
              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
            >
              {effectiveIsIncome
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              }
            </svg>
          </span>
        )}
        {splitTransactionIds?.has(transactionId) && (
          <span title="Split with partner" className="inline-flex shrink-0 items-center">
            <svg className="h-3.5 w-3.5 text-pink-500 dark:text-pink-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </span>
        )}
      </>
    );
  }

  return (
    <>
      {isProjected && (
        <span className="inline-flex shrink-0 items-center rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-500 dark:bg-stone-700 dark:text-stone-400">
          PROJECTED
        </span>
      )}
      {isPending && (
        <span className="inline-flex shrink-0 items-center rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
          PENDING
        </span>
      )}
      {isTransfer && (
        <span className="inline-flex shrink-0 items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-stone-700 dark:text-stone-400">
          TRANSFER
        </span>
      )}
      {isLinkedTransfer && (
        <span
          className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
            effectiveIsIncome
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
          }`}
          title={effectiveIsIncome ? 'Linked transfer in (money received)' : 'Linked transfer out (money sent)'}
        >
          {effectiveIsIncome ? '↓' : '↑'} LINKED
        </span>
      )}
      {splitTransactionIds?.has(transactionId) && (
        <span
          className="inline-flex shrink-0 items-center rounded-md bg-pink-100 px-1.5 py-0.5 text-[10px] font-semibold text-pink-700 dark:bg-pink-900/30 dark:text-pink-400"
          title="Split with partner"
        >
          SPLIT
        </span>
      )}
    </>
  );
}

/**
 * Inline editable cell — renders display text, switches to input on click.
 */
function EditableCell({ value, onChange, type = 'text', className = '', options, displayValue }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [prevValue, setPrevValue] = useState(value);
  const inputRef = useRef(null);

  // Sync draft when value prop changes (adjust state during render, not in an effect)
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value ?? '');
  }

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  const cancel = () => { setEditing(false); setDraft(value ?? ''); setPrevValue(value); };

  if (!editing) {
    return (
      <span
        className={`cursor-text rounded px-1 -mx-1 transition-colors hover:bg-amber-50/60 dark:hover:bg-amber-900/20 ${className}`}
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title="Click to edit"
      >
        {displayValue ?? value ?? '—'}
      </span>
    );
  }

  // Select / dropdown
  if (type === 'select' && options) {
    return (
      <select
        ref={inputRef}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); }}
        onBlur={() => { commit(); }}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-lg border border-amber-400 bg-white px-2 py-1 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-stone-700 dark:text-stone-100 dark:border-amber-500"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    );
  }

  return (
    <input
      ref={inputRef}
      type={type}
      value={draft}
      onChange={(e) => setDraft(type === 'number' ? e.target.value : e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') cancel();
      }}
      onClick={(e) => e.stopPropagation()}
      step={type === 'number' ? '0.01' : undefined}
      className={`w-full rounded-lg border border-amber-400 bg-white px-2 py-1 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:bg-stone-700 dark:text-stone-100 dark:border-amber-500 ${
        type === 'number' ? 'text-right' : ''
      }`}
    />
  );
}

/** Single menu item button used inside KebabMenu's dropdown. */
function DropdownItem({ onClick, onClose, colorClass, children }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClose(); onClick(e); }}
      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${colorClass}`}
    >
      {children}
    </button>
  );
}

/**
 * KebabMenu — single ⋮ button that opens a portal-rendered dropdown of row actions.
 * Uses fixed positioning so the dropdown is never clipped by the scrollable table container.
 */
function KebabMenu({ transaction, isNotPosted, isTransfer, splitTransactionIds, onConfirm, onSkip, onSplit, onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef(null);

  const toggle = (e) => {
    e.stopPropagation();
    if (!open) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: Math.min(rect.bottom + 4, window.innerHeight - 240),
        right: Math.max(window.innerWidth - rect.right, 8),
      });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-stone-700 dark:hover:text-stone-200"
        title="Actions"
      >
        <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>

      {open && createPortal(
        <div
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="min-w-40 rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {isNotPosted && onConfirm && (
            <DropdownItem
              onClick={() => onConfirm(transaction.id)}
              onClose={close}
              colorClass="text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Confirm
            </DropdownItem>
          )}
          {isNotPosted && onSkip && (
            <DropdownItem
              onClick={() => onSkip(transaction.id)}
              onClose={close}
              colorClass="text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z" />
              </svg>
              Skip
            </DropdownItem>
          )}
          {onSplit && !splitTransactionIds?.has(transaction.id) && !isTransfer && (
            <DropdownItem
              onClick={() => onSplit(transaction)}
              onClose={close}
              colorClass="text-pink-600 hover:bg-pink-50 dark:text-pink-400 dark:hover:bg-pink-900/30"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              Split
            </DropdownItem>
          )}
          {isNotPosted && onSkip && <hr className="my-1 border-stone-100 dark:border-stone-700" />}
          <DropdownItem
            onClick={() => onEdit(transaction)}
            onClose={close}
            colorClass="text-stone-700 hover:bg-amber-50 hover:text-amber-700 dark:text-stone-300 dark:hover:bg-amber-900/30 dark:hover:text-amber-400"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            Edit
          </DropdownItem>
          <DropdownItem
            onClick={() => onDelete(transaction)}
            onClose={close}
            colorClass="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            Delete
          </DropdownItem>
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * TransactionItem — single transaction row with inline editing + checkbox.
 *
 * Props:
 *  - transaction: transaction object (with nested categories)
 *  - onEdit(transaction): open edit modal (fallback)
 *  - onDelete(transaction): open delete confirmation
 *  - isSelected: boolean
 *  - onToggleSelect(id): toggle selection
 *  - pendingEdits: object of pending field changes for this row (or null)
 *  - onCellEdit(id, field, value): register a cell edit
 *  - categories: all categories (for inline category dropdown)
 *  - onConfirm(id): confirm a pending transaction → posted
 *  - onSkip(id): skip (soft-delete) a projected/pending transaction
 *  - onSplit(transaction): open split modal for this transaction
 *  - splitTransactionIds: Set<string> of transaction IDs that have been split
 */
const TransactionItem = forwardRef(function TransactionItem({
  transaction,
  onEdit,
  onDelete,
  isSelected,
  onToggleSelect,
  pendingEdits,
  onCellEdit,
  categories,
  accounts,
  runningBalance,
  onConfirm,
  onSkip,
  onSplit,
  splitTransactionIds,
  isMobile = false,
  ...rest
}, ref) {
  const category = transaction.categories;
  const account = transaction.accounts;
  const isIncome = transaction.is_income;
  const isTransfer = category?.type === 'transfer';
  const isLinkedTransfer = !isTransfer && !!transaction.transfer_group_id;
  const hasPending = pendingEdits && Object.keys(pendingEdits).length > 0;
  const txStatus = transaction.status || 'posted';
  const isProjected = txStatus === 'projected';
  const isPending = txStatus === 'pending';
  const isNotPosted = isProjected || isPending;

  // Build category options for dropdown
  const categoryOptions = (categories || []).map((c) => ({
    value: c.id,
    label: `${c.name} (${c.type})`,
  }));

  // Build account options for dropdown — include closed accounts with label since this edits existing transactions
  const accountOptions = (accounts || []).map((a) => ({
    value: a.id,
    label: maskAccountName(a.name) + (a.closed_at ? ' (Closed)' : ''),
  }));

  // Determine displayed values (pendingEdits override originals)
  const displayDesc = pendingEdits?.description ?? transaction.description;
  const displayPayee = pendingEdits?.payee ?? transaction.payee;
  const displayDate = pendingEdits?.transaction_date ?? transaction.transaction_date;
  const displayCategoryId = pendingEdits?.category_id ?? transaction.category_id;
  const displayAccountId = pendingEdits?.account_id ?? transaction.account_id;
  const displayAmount = pendingEdits?.amount != null
    ? Math.abs(pendingEdits.amount)
    : Math.abs(transaction.amount);

  // Effective is_income (pending edit overrides original)
  const effectiveIsIncome = pendingEdits?.is_income != null ? pendingEdits.is_income : isIncome;

  // Find display category
  const displayCategory = pendingEdits?.category_id
    ? (categories || []).find((c) => c.id === pendingEdits.category_id)
    : category;

  // Find display account
  const displayAccount = pendingEdits?.account_id
    ? (accounts || []).find((a) => a.id === pendingEdits.account_id)
    : account;
  const mobilePrimaryText = displayPayee || displayDesc || '—';
  const mobileSecondaryText = displayPayee && displayDesc && displayDesc !== displayPayee ? displayDesc : '';
  const hasAnyBadge = isProjected || isPending || isTransfer || isLinkedTransfer || splitTransactionIds?.has(transaction.id);

  if (isMobile) {
    return (
      <tr
        ref={ref}
        {...rest}
        className={`border-b border-stone-100 align-top transition-colors dark:border-stone-700/50 ${
          isProjected ? 'bg-stone-50/30 opacity-60 dark:bg-stone-800/30'
          : isPending ? 'bg-violet-50/30 dark:bg-violet-900/10'
          : 'hover:bg-stone-50/50 dark:hover:bg-stone-700/30'
        } ${hasPending ? 'border-l-2 border-l-amber-400' : ''}`}
      >
        <td className="px-3 py-2 whitespace-nowrap">
          <button
            type="button"
            onClick={() => onEdit(transaction)}
            className="text-left text-xs font-medium text-stone-600 transition-colors hover:text-amber-600 dark:text-stone-300 dark:hover:text-amber-400"
          >
            {formatDate(displayDate)}
          </button>
        </td>

        <td className="overflow-hidden px-1 py-2">
          <button
            type="button"
            onClick={() => onEdit(transaction)}
            className="flex w-full min-w-0 flex-col items-start text-left"
          >
            <span className="w-full truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
              {mobilePrimaryText}
            </span>
            {(displayCategory || mobileSecondaryText || hasAnyBadge) && (
              <span className="mt-0.5 flex w-full min-w-0 items-center gap-1.5">
                {displayCategory && (
                  <span
                    title={displayCategory.name}
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: displayCategory.color }}
                  />
                )}
                {mobileSecondaryText && (
                  <span className="min-w-0 flex-1 truncate text-xs text-stone-500 dark:text-stone-400">
                    {mobileSecondaryText}
                  </span>
                )}
                <TransactionStatusBadges
                  compact
                  isProjected={isProjected}
                  isPending={isPending}
                  isTransfer={isTransfer}
                  isLinkedTransfer={isLinkedTransfer}
                  effectiveIsIncome={effectiveIsIncome}
                  splitTransactionIds={splitTransactionIds}
                  transactionId={transaction.id}
                />
              </span>
            )}
          </button>
        </td>

        <td className={`px-3 py-2 text-right text-sm font-semibold tabular-nums whitespace-nowrap ${
          effectiveIsIncome ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
        }`}>
          <button
            type="button"
            onClick={() => onEdit(transaction)}
            className={`inline-flex items-center gap-1 rounded-lg px-1 py-0.5 ${
              effectiveIsIncome ? 'hover:bg-emerald-50 dark:hover:bg-emerald-900/20' : 'hover:bg-red-50 dark:hover:bg-red-900/20'
            }`}
          >
            <span className="text-xs font-bold">{isTransfer ? (effectiveIsIncome ? '↓' : '↑') : (effectiveIsIncome ? '+' : '−')}</span>
            <span>{formatCurrency(displayAmount)}</span>
          </button>
        </td>

        <td className="px-2 py-2 text-right whitespace-nowrap">
          <KebabMenu
            transaction={transaction}
            isNotPosted={isNotPosted}
            isTransfer={isTransfer}
            splitTransactionIds={splitTransactionIds}
            onConfirm={onConfirm}
            onSkip={onSkip}
            onSplit={onSplit}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr
      ref={ref}
      {...rest}
      className={`group border-b border-stone-100 transition-colors cursor-pointer dark:border-stone-700/50 ${
        isSelected ? 'bg-amber-50/50 dark:bg-amber-900/20'
        : isProjected ? 'bg-stone-50/30 opacity-50 dark:bg-stone-800/30'
        : isPending ? 'bg-violet-50/30 dark:bg-violet-900/10'
        : 'hover:bg-stone-50/50 dark:hover:bg-stone-700/30'
      } ${hasPending ? 'border-l-2 border-l-amber-400' : ''}`}
    >
      {/* Checkbox */}
      <td className="w-10 px-3 py-3">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(transaction.id); }}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0"
        />
      </td>

      {/* Date */}
      <td className="px-4 py-3 text-sm text-stone-900 whitespace-nowrap dark:text-stone-100">
        <EditableCell
          value={displayDate}
          type="date"
          displayValue={formatDate(displayDate)}
          onChange={(val) => onCellEdit(transaction.id, 'transaction_date', val)}
        />
      </td>

      {/* Account */}
      <td className="px-4 py-3 overflow-hidden">
        <EditableCell
          value={displayAccountId}
          type="select"
          options={accountOptions}
          displayValue={
            displayAccount ? (
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${getAccountBadgeColor(displayAccount.type)}`}>
                {maskAccountName(displayAccount.name)}
              </span>
            ) : (
              <span className="text-xs text-stone-400">—</span>
            )
          }
          onChange={(val) => onCellEdit(transaction.id, 'account_id', val)}
        />
      </td>

      {/* Payee */}
      <td className="px-4 py-3 text-sm text-stone-500 dark:text-stone-400">
        <div className="truncate">
          <EditableCell
            value={displayPayee || ''}
            displayValue={displayPayee || '—'}
            onChange={(val) => onCellEdit(transaction.id, 'payee', val)}
          />
        </div>
      </td>

      {/* Category */}
      <td className="px-4 py-3 overflow-hidden">
        <EditableCell
          value={displayCategoryId}
          type="select"
          options={categoryOptions}
          displayValue={
            displayCategory ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-700 dark:bg-stone-700 dark:text-stone-300">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: displayCategory.color }}
                />
                {displayCategory.name}
              </span>
            ) : (
              <span className="text-xs text-stone-400">—</span>
            )
          }
          onChange={(val) => onCellEdit(transaction.id, 'category_id', val)}
        />
      </td>

      {/* Description */}
      <td className="px-4 py-3 text-sm text-stone-600 dark:text-stone-300">
        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <EditableCell
            value={displayDesc}
            onChange={(val) => onCellEdit(transaction.id, 'description', val)}
          />
          <TransactionStatusBadges
            isProjected={isProjected}
            isPending={isPending}
            isTransfer={isTransfer}
            isLinkedTransfer={isLinkedTransfer}
            effectiveIsIncome={effectiveIsIncome}
            splitTransactionIds={splitTransactionIds}
            transactionId={transaction.id}
          />
        </div>
      </td>

      {/* Amount */}
      <td className={`px-4 py-3 text-right text-sm font-medium whitespace-nowrap ${
        effectiveIsIncome
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-500 dark:text-red-400'
      }`}>
        <div className="inline-flex items-center gap-0.5">
          {/* Clickable type indicator — toggles income/expense */}
          {!isTransfer ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                const newIsIncome = !effectiveIsIncome;
                onCellEdit(transaction.id, 'is_income', newIsIncome);
                // Ensure amount is always stored as positive (is_income flag determines direction)
                const currentAmt = pendingEdits?.amount != null ? pendingEdits.amount : transaction.amount;
                onCellEdit(transaction.id, 'amount', Math.abs(currentAmt));
              }}
              className={`rounded px-1 py-0.5 text-xs font-bold transition-colors ${
                effectiveIsIncome
                  ? 'text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30'
                  : 'text-stone-500 hover:bg-red-50 dark:text-stone-400 dark:hover:bg-red-900/30'
              }`}
              title={`Click to switch to ${effectiveIsIncome ? 'expense' : 'income'}`}
            >
              {effectiveIsIncome ? '+' : '−'}
            </button>
          ) : (
            <span
              className={`px-1 py-0.5 text-xs font-bold ${
                effectiveIsIncome
                  ? 'text-teal-500 dark:text-teal-400'
                  : 'text-rose-400 dark:text-rose-400'
              }`}
              title={effectiveIsIncome ? 'Transfer in (money received)' : 'Transfer out (money sent)'}
            >
              {effectiveIsIncome ? '↓' : '↑'}
            </span>
          )}
          <EditableCell
            value={String(toDollars(displayAmount))}
            type="number"
            className="text-right"
            displayValue={formatCurrency(displayAmount)}
            onChange={(val) => {
              const cents = toCents(Math.abs(Number(val)));
              onCellEdit(transaction.id, 'amount', cents);
            }}
          />
        </div>
      </td>

      {/* Balance */}
      <td className={`px-4 py-3 text-right text-sm font-medium tabular-nums whitespace-nowrap ${
        runningBalance == null
          ? 'text-stone-400 dark:text-stone-500'
          : isAssetAccount(displayAccount?.type)
            ? (runningBalance >= 0 ? 'text-stone-900 dark:text-stone-100' : 'text-red-600 dark:text-red-400')
            : (runningBalance > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')
      }`}>
        {runningBalance != null ? formatCurrency(Math.abs(runningBalance)) : '—'}
      </td>

      {/* Actions — kebab (⋮) button opens a portal dropdown */}
      <td className="px-2 py-3 text-right whitespace-nowrap">
        <KebabMenu
          transaction={transaction}
          isNotPosted={isNotPosted}
          isTransfer={isTransfer}
          splitTransactionIds={splitTransactionIds}
          onConfirm={onConfirm}
          onSkip={onSkip}
          onSplit={onSplit}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </td>
    </tr>
  );
});

export default TransactionItem;
