import { useState, useRef, useEffect, forwardRef } from 'react';
import { createPortal } from 'react-dom';
import { formatCurrency, formatDate } from '../../utils/helpers';

/** Single menu item button used inside GroupKebabMenu's dropdown. */
function GroupDropdownItem({ onClick, onClose, colorClass, children }) {
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
 * GroupKebabMenu — ⋮ button that opens a portal dropdown with bulk actions for the group.
 */
function GroupKebabMenu({ children, isNotPosted, onConfirmAll, onSkipAll, onEditAll, onDeleteAll }) {
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
        title="Group actions"
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
          className="min-w-44 rounded-xl border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {isNotPosted && onConfirmAll && (
            <GroupDropdownItem
              onClick={() => onConfirmAll(children)}
              onClose={close}
              colorClass="text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
              Confirm All
            </GroupDropdownItem>
          )}
          {isNotPosted && onSkipAll && (
            <GroupDropdownItem
              onClick={() => onSkipAll(children)}
              onClose={close}
              colorClass="text-orange-600 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z" />
              </svg>
              Skip All
            </GroupDropdownItem>
          )}
          {isNotPosted && <hr className="my-1 border-stone-100 dark:border-stone-700" />}
          {onEditAll && (
            <GroupDropdownItem
              onClick={() => onEditAll(children)}
              onClose={close}
              colorClass="text-stone-700 hover:bg-amber-50 hover:text-amber-700 dark:text-stone-300 dark:hover:bg-amber-900/30 dark:hover:text-amber-400"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Edit All
            </GroupDropdownItem>
          )}
          {onDeleteAll && (
            <GroupDropdownItem
              onClick={() => onDeleteAll(children)}
              onClose={close}
              colorClass="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
              Delete All
            </GroupDropdownItem>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * TransactionGroupHeader — collapsible header row for a group of transactions.
 *
 * Shows: chevron, group label, child count badge, status badges, net amount, running balance, kebab menu.
 */
const TransactionGroupHeader = forwardRef(function TransactionGroupHeader({
  group,
  isExpanded,
  onToggleExpand,
  runningBalance,
  isMobile = false,
  isSelected,
  isIndeterminate,
  onToggleSelect,
  splitTransactionIds,
  onConfirmAll,
  onSkipAll,
  onEditAll,
  onDeleteAll,
  ...rest
}, ref) {
  const { label, netAmount, children, isRecurringGroup, categoryColor, date } = group;
  const isPositive = netAmount >= 0;
  const amountColor = isPositive
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-500 dark:text-red-400';

  // Derive status from children
  const hasProjected = children.some((c) => c.status === 'projected');
  const hasPending = children.some((c) => c.status === 'pending');
  const hasTransfer = children.some((c) => c.categories?.type === 'transfer');
  const hasSplit = splitTransactionIds && children.some((c) => splitTransactionIds.has(c.id));
  const isNotPosted = hasProjected || hasPending;

  // Row background based on status (pending takes priority over projected)
  const rowBg = hasPending
    ? 'bg-amber-50/30 dark:bg-amber-900/10'
    : hasProjected
      ? 'bg-stone-50/30 opacity-60 dark:bg-stone-800/30'
      : 'bg-stone-50/80 dark:bg-stone-800/60';

  // Shared description: if all children have the same non-empty description, show it
  const firstDesc = children[0]?.description || '';
  const sharedDescription = firstDesc && children.every((c) => c.description === firstDesc)
    ? firstDesc
    : null;
  const displayLabel = sharedDescription ?? label;

  // Inline badge pills (non-compact) for group header
  const statusBadges = (
    <>
      {hasProjected && (
        <span className="inline-flex shrink-0 items-center rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-500 dark:bg-stone-700 dark:text-stone-400">
          PROJECTED
        </span>
      )}
      {hasPending && (
        <span className="inline-flex shrink-0 items-center rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
          PENDING
        </span>
      )}
      {hasTransfer && (
        <span className="inline-flex shrink-0 items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-stone-700 dark:text-stone-400">
          TRANSFER
        </span>
      )}
      {hasSplit && (
        <span className="inline-flex shrink-0 items-center rounded-md bg-pink-100 px-1.5 py-0.5 text-[10px] font-semibold text-pink-700 dark:bg-pink-900/30 dark:text-pink-400">
          SPLIT
        </span>
      )}
    </>
  );

  // Compact (icon) badges for mobile
  const statusBadgesCompact = (
    <>
      {hasProjected && (
        <span title="Projected" className="inline-flex shrink-0 items-center">
          <svg className="h-3.5 w-3.5 text-stone-400 dark:text-stone-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
      )}
      {hasPending && (
        <span title="Pending" className="inline-flex shrink-0 items-center">
          <svg className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
          </svg>
        </span>
      )}
      {hasTransfer && (
        <span title="Transfer" className="inline-flex shrink-0 items-center">
          <svg className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        </span>
      )}
      {hasSplit && (
        <span title="Split with partner" className="inline-flex shrink-0 items-center">
          <svg className="h-3.5 w-3.5 text-pink-500 dark:text-pink-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        </span>
      )}
    </>
  );

  if (isMobile) {
    return (
      <tr
        ref={ref}
        {...rest}
        className={`border-b border-stone-100 transition-colors dark:border-stone-700/50 cursor-pointer ${rowBg}`}
        onClick={onToggleExpand}
      >
        {/* Date */}
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="text-xs font-medium text-stone-600 dark:text-stone-300">
            {formatDate(date)}
          </span>
        </td>

        {/* Label + expand + badge */}
        <td className="overflow-hidden px-1 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {/* Chevron */}
            <svg
              className={`h-3.5 w-3.5 shrink-0 text-stone-400 transition-transform dark:text-stone-500 ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            {/* Category dot */}
            {categoryColor && (
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: categoryColor }}
              />
            )}
            <span className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
              {displayLabel}
            </span>
            <span className="shrink-0 rounded-full bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-400">
              {children.length}
            </span>
            {isRecurringGroup && (
              <span className="shrink-0 text-[10px] font-semibold text-violet-500 dark:text-violet-400">
                ↻
              </span>
            )}
            {statusBadgesCompact}
          </div>
        </td>

        {/* Net amount */}
        <td className={`px-3 py-2 text-right text-sm font-semibold tabular-nums whitespace-nowrap ${amountColor}`}>
          <span className="text-xs font-bold">{isPositive ? '+' : '−'}</span>
          {formatCurrency(Math.abs(netAmount))}
        </td>

        {/* Actions — kebab menu */}
        <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
          <GroupKebabMenu
            children={children}
            isNotPosted={isNotPosted}
            onConfirmAll={onConfirmAll}
            onSkipAll={onSkipAll}
            onEditAll={onEditAll}
            onDeleteAll={onDeleteAll}
          />
        </td>
      </tr>
    );
  }

  return (
    <tr
      ref={ref}
      {...rest}
      className={`border-b border-stone-100 transition-colors dark:border-stone-700/50 cursor-pointer hover:brightness-95 dark:hover:brightness-110 ${rowBg}`}
      onClick={onToggleExpand}
    >
      {/* Checkbox */}
      <td className="w-10 px-3 py-3">
        <input
          type="checkbox"
          checked={isSelected}
          ref={(el) => { if (el) el.indeterminate = isIndeterminate; }}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(); }}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0"
        />
      </td>

      {/* Date */}
      <td className="px-4 py-3 text-sm text-stone-900 whitespace-nowrap dark:text-stone-100">
        {formatDate(date)}
      </td>

      {/* Account — blank for group */}
      <td className="px-4 py-3" />

      {/* Payee / Label with chevron — colSpan=3 covers payee+category+description columns */}
      <td className="px-4 py-3" colSpan={3}>
        <div className="flex items-center gap-2">
          {/* Chevron */}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            className="rounded p-0.5 transition-colors hover:bg-stone-200 dark:hover:bg-stone-600"
          >
            <svg
              className={`h-4 w-4 text-stone-500 transition-transform dark:text-stone-400 ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2.5}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
          </button>
          {/* Category dot */}
          {categoryColor && (
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColor }}
            />
          )}
          <span className="font-semibold text-stone-900 dark:text-stone-100">
            {displayLabel}
          </span>
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-400">
            {children.length} items
          </span>
          {isRecurringGroup && (
            <span className="text-[10px] font-semibold text-violet-500 dark:text-violet-400" title="Recurring group">
              ↻ Recurring
            </span>
          )}
          {statusBadges}
        </div>
      </td>

      {/* Net Amount */}
      <td className={`px-4 py-3 text-right text-sm font-semibold whitespace-nowrap ${amountColor}`}>
        <span className="text-xs font-bold">{isPositive ? '+' : '−'}</span>
        {formatCurrency(Math.abs(netAmount))}
      </td>

      {/* Balance */}
      <td className="px-4 py-3 text-right text-sm tabular-nums text-stone-500 dark:text-stone-400 whitespace-nowrap">
        {runningBalance != null ? formatCurrency(runningBalance) : ''}
      </td>

      {/* Actions — kebab menu */}
      <td className="px-2 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
        <GroupKebabMenu
          children={children}
          isNotPosted={isNotPosted}
          onConfirmAll={onConfirmAll}
          onSkipAll={onSkipAll}
          onEditAll={onEditAll}
          onDeleteAll={onDeleteAll}
        />
      </td>
    </tr>
  );
});

export default TransactionGroupHeader;
