import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import TransactionItem from './TransactionItem';
import TransactionGroupHeader from './TransactionGroupHeader';
import { transactionListRows } from '../../utils/transactionGrouping';
import { formatDate } from '../../utils/helpers';

const SORT_COLUMNS = [
  { key: 'transaction_date', label: 'Date', align: 'left' },
  { key: 'account', label: 'Account', align: 'left' },
  { key: 'payee', label: 'Payee', align: 'left' },
  { key: 'category', label: 'Category', align: 'left' },
  { key: 'description', label: 'Description', align: 'left' },
  { key: 'amount', label: 'Amount', align: 'right' },
];

const MOBILE_SORT_COLUMNS = [
  { key: 'payee', label: 'Payee', align: 'left' },
  { key: 'amount', label: 'Amount', align: 'right' },
];

function SortArrow({ direction }) {
  if (!direction) return null;
  return (
    <svg
      className={`ml-1 inline h-3 w-3 transition-transform ${direction === 'asc' ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2.5}
      stroke="currentColor"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  );
}

/**
 * TransactionList — virtual-scrolled table with sortable headers and checkboxes.
 *
 * Props:
 *  - transactions: filtered & sorted Array
 *  - onEdit, onDelete: row actions
 *  - sortColumn, sortDirection, onSort(column): sorting
 *  - selectedIds: Set<string>
 *  - onToggleSelect(id), onSelectAll(): checkbox handlers
 *  - pendingEdits: Map<id, {field: value}>
 *  - onCellEdit(id, field, value): inline edit handler
 *  - categories: all categories (for inline dropdown)
 *  - viewMode: 'monthly' | 'yearly'
 *  - emptyMessage: string
 */
export default function TransactionList({
  transactions,
  groupedItems,
  expandedGroups,
  onToggleGroupExpand,
  onEdit,
  onDelete,
  sortColumn,
  sortDirection,
  onSort,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  pendingEdits,
  onCellEdit,
  categories,
  accounts,
  emptyMessage,
  onConfirm,
  onSkip,
  onRecalculate,
  onSplit,
  splitTransactionIds,
  onConfirmAll,
  onSkipAll,
  onEditAll,
  onDeleteAll,
  scrollKey,
  scrollToTransactionId = null,
}) {
  const parentRef = useRef(null);
  const [isCompact, setIsCompact] = useState(false);
  const hasRows = transactions.length > 0;
  useLayoutEffect(() => {
    const list = parentRef.current;
    if (!list) return;
    const measure = () => setIsCompact(list.clientWidth < 900);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasRows]);
  const groupByDate = isCompact && sortColumn === 'transaction_date';

  // Flatten grouped items into virtual rows: group headers, child rows, and standalone transactions
  const flatRows = useMemo(
    () => transactionListRows(transactions, groupedItems, expandedGroups, groupByDate),
    [transactions, groupedItems, expandedGroups, groupByDate],
  );

  const getItemKey = useCallback((index) => {
    const row = flatRows[index];
    return row.rowType === 'date' ? row.date : row.group?.groupKey ?? row.transaction.id;
  }, [flatRows]);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    getItemKey,
    estimateSize: (index) => flatRows[index].rowType === 'date' ? 28 : (isCompact ? 56 : 52),
    scrollPaddingStart: 48,
    overscan: 10,
  });

  // Scroll to the transaction nearest to today whenever a new data load completes
  useEffect(() => {
    if (!scrollKey || !scrollToTransactionId) return;
    const idx = flatRows.findIndex((row) =>
      row.transaction?.id === scrollToTransactionId || row.group?.children.some((tx) => tx.id === scrollToTransactionId)
    );
    if (idx >= 0) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(flatRows[idx - 1]?.rowType === 'date' ? idx - 1 : idx, { align: 'start' });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const allSelected = transactions.length > 0 && selectedIds.size === transactions.length;
  const someSelected = selectedIds.size > 0 && !allSelected;
  const activeColumns = isCompact ? MOBILE_SORT_COLUMNS : SORT_COLUMNS;
  const columnCount = isCompact ? 4 : 8;

  if (transactions.length === 0) {
    return (
      <div className="rounded-2xl border border-stone-200/60 bg-white p-12 text-center shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
        <p className="text-base text-stone-500 dark:text-stone-400">{emptyMessage || 'No transactions found.'}</p>
        <p className="mt-1 text-sm text-stone-400 dark:text-stone-500">
          Try adjusting your filters or add a new transaction.
        </p>
      </div>
    );
  }

  const virtualItems = virtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? (virtualItems[0].start ?? 0) : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? virtualizer.getTotalSize() - (virtualItems.at(-1).end ?? 0)
      : 0;

  return (
    <>
      <div
        ref={parentRef}
        className="max-h-[70vh] overflow-y-auto overflow-x-hidden sm:overflow-x-auto rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50"
      >
        <table className="w-full table-fixed text-sm">
          <colgroup>
            {isCompact ? (
              <>
                <col className="w-7 sm:w-9" />
                <col />
                <col className="w-24 sm:w-28" />
                <col className="w-8 sm:w-11" />
              </>
            ) : (
              <>
                <col style={{ width: '40px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '130px' }} />
                <col style={{ width: '160px' }} />
                <col />
                <col style={{ width: '110px' }} />
                <col style={{ width: '48px' }} />
              </>
            )}
          </colgroup>

          <thead className="sticky top-0 z-10 border-b border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
            <tr>
              <th className="px-2 py-3">
                <input
                  type="checkbox"
                  aria-label="Select all visible transactions"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={onSelectAll}
                  className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0"
                />
              </th>
              {activeColumns.map((col) => (
                <th
                  key={col.key}
                  className={`cursor-pointer select-none font-semibold text-stone-600 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200 ${
                    isCompact ? 'px-3 py-2.5 text-xs uppercase tracking-wide' : 'px-4 py-3'
                  } ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                >
                  {isCompact && col.key === 'payee' && (
                    <button type="button" onClick={() => onSort('transaction_date')} className="mr-3 py-1" aria-label="Sort by date">
                      Date{groupByDate && <SortArrow direction={sortDirection} />}
                    </button>
                  )}
                  <button type="button" onClick={() => onSort(col.key)} className="py-1" aria-label={`Sort by ${col.label.toLowerCase()}`}>
                    {col.label}
                    {sortColumn === col.key && <SortArrow direction={sortDirection} />}
                  </button>
                </th>
              ))}
              <th className={`${isCompact ? 'px-2 py-2.5' : 'px-4 py-3'} text-right font-semibold text-stone-600 dark:text-stone-400`}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {paddingTop > 0 && (
              <tr><td colSpan={columnCount} style={{ height: paddingTop, padding: 0 }} /></tr>
            )}
            {virtualItems.map((virtualRow) => {
              const row = flatRows[virtualRow.index];

              if (row.rowType === 'date') {
                return (
                  <tr key={row.date} ref={virtualizer.measureElement} data-index={virtualRow.index}>
                    <td colSpan={columnCount} className="bg-stone-100 px-3 py-1.5 text-xs font-semibold text-stone-600 dark:bg-stone-700 dark:text-stone-200">
                      <time dateTime={row.date}>{formatDate(row.date)}</time>
                    </td>
                  </tr>
                );
              }
              if (row.rowType === 'groupHeader') {
                const { group } = row;
                const isExpanded = expandedGroups?.has(group.groupKey);
                // Check group selection state
                const allChildIds = group.children.map((c) => c.id);
                const selectedCount = allChildIds.filter((id) => selectedIds.has(id)).length;
                const groupAllSelected = selectedCount === allChildIds.length;
                const groupSomeSelected = selectedCount > 0 && !groupAllSelected;

                return (
                  <TransactionGroupHeader
                    key={group.groupKey}
                    ref={virtualizer.measureElement}
                    data-index={virtualRow.index}
                    group={group}
                    isExpanded={isExpanded}
                    onToggleExpand={() => onToggleGroupExpand(group.groupKey)}
                    isCompact={isCompact}
                    showRowDate={!groupByDate}
                    isSelected={groupAllSelected}
                    isIndeterminate={groupSomeSelected}
                    onToggleSelect={() => {
                      for (const id of allChildIds) {
                        if (groupAllSelected) {
                          if (selectedIds.has(id)) onToggleSelect(id);
                        } else {
                          if (!selectedIds.has(id)) onToggleSelect(id);
                        }
                      }
                    }}
                    splitTransactionIds={splitTransactionIds}
                    onConfirmAll={onConfirmAll}
                    onSkipAll={onSkipAll}
                    onEditAll={onEditAll}
                    onDeleteAll={onDeleteAll}
                  />
                );
              }

              const tx = row.transaction;
              const edits = pendingEdits.get(tx.id) || null;
              const isChild = row.rowType === 'groupChild';
              return (
                <TransactionItem
                  key={tx.id}
                  ref={virtualizer.measureElement}
                  data-index={virtualRow.index}
                  transaction={tx}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  isSelected={selectedIds.has(tx.id)}
                  onToggleSelect={onToggleSelect}
                  pendingEdits={edits}
                  onCellEdit={onCellEdit}
                  categories={categories}
                  accounts={accounts}
                  onConfirm={onConfirm}
                  onSkip={onSkip}
                  onRecalculate={onRecalculate}
                  onSplit={onSplit}
                  splitTransactionIds={splitTransactionIds}
                  isCompact={isCompact}
                  showRowDate={!groupByDate}
                  isGroupChild={isChild}
                />
              );
            })}
            {paddingBottom > 0 && (
              <tr><td colSpan={columnCount} style={{ height: paddingBottom, padding: 0 }} /></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
