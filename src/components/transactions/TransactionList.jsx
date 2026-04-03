import { useEffect, useRef, useState, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import TransactionItem from './TransactionItem';
import TransactionGroupHeader from './TransactionGroupHeader';

const SORT_COLUMNS = [
  { key: 'transaction_date', label: 'Date', align: 'left' },
  { key: 'account', label: 'Account', align: 'left' },
  { key: 'payee', label: 'Payee', align: 'left' },
  { key: 'category', label: 'Category', align: 'left' },
  { key: 'description', label: 'Description', align: 'left' },
  { key: 'amount', label: 'Amount', align: 'right' },
];

const MOBILE_SORT_COLUMNS = [
  { key: 'transaction_date', label: 'Date', align: 'left' },
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
  balanceMap,
  emptyMessage,
  onConfirm,
  onSkip,
  onSplit,
  splitTransactionIds,
  onConfirmAll,
  onSkipAll,
  onEditAll,
  onDeleteAll,
  scrollKey,
  initialScrollToIndex = 0,
}) {
  const parentRef = useRef(null);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const mediaQuery = window.matchMedia('(max-width: 639px)');
    const handleChange = (event) => setIsMobile(event.matches);

    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Flatten grouped items into virtual rows: group headers, child rows, and standalone transactions
  const flatRows = useMemo(() => {
    if (!groupedItems || groupedItems.length === 0) {
      // Fallback: render flat list if no grouped items provided
      return transactions.map((tx) => ({ rowType: 'transaction', transaction: tx }));
    }
    const rows = [];
    for (const item of groupedItems) {
      if (item.type === 'group') {
        rows.push({ rowType: 'groupHeader', group: item });
        if (expandedGroups?.has(item.groupKey)) {
          for (const child of item.children) {
            rows.push({ rowType: 'groupChild', transaction: child, groupKey: item.groupKey });
          }
        }
      } else {
        rows.push({ rowType: 'transaction', transaction: item.transaction });
      }
    }
    return rows;
  }, [groupedItems, expandedGroups, transactions]);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (isMobile ? 56 : 52),
    overscan: 10,
  });

  // Scroll to first posted transaction whenever a new data load completes
  useEffect(() => {
    if (!scrollKey) return;
    if (initialScrollToIndex > 0) {
      requestAnimationFrame(() => {
        virtualizer.scrollToIndex(initialScrollToIndex, { align: 'center' });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const allSelected = transactions.length > 0 && selectedIds.size === transactions.length;
  const someSelected = selectedIds.size > 0 && !allSelected;
  const activeColumns = isMobile ? MOBILE_SORT_COLUMNS : SORT_COLUMNS;
  const columnCount = isMobile ? 4 : 9;

  const handleSort = (column) => {
    onSort(column);
  };

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
          {/* Explicit desktop widths keep headers and rows aligned; mobile uses a compact 4-column layout */}
          <colgroup>
            {isMobile ? (
              <>
                <col style={{ width: '84px' }} />
                <col />
                <col style={{ width: '112px' }} />
                <col style={{ width: '44px' }} />
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
                <col style={{ width: '110px' }} />
                <col style={{ width: '48px' }} />
              </>
            )}
          </colgroup>

          <thead className="sticky top-0 z-10 border-b border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800">
            <tr>
              {!isMobile && (
                <th className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={onSelectAll}
                    className="h-4 w-4 rounded border-stone-300 text-amber-500 focus:ring-2 focus:ring-amber-500 focus:ring-offset-0"
                  />
                </th>
              )}
              {activeColumns.map((col) => (
                <th
                  key={col.key}
                  className={`cursor-pointer select-none font-semibold text-stone-600 transition-colors hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-200 ${
                    isMobile ? 'px-3 py-2.5 text-xs uppercase tracking-wide' : 'px-4 py-3'
                  } ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortColumn === col.key && <SortArrow direction={sortDirection} />}
                </th>
              ))}
              {!isMobile && (
                <th className="px-4 py-3 text-right font-semibold text-stone-600 dark:text-stone-400">
                  Balance
                </th>
              )}
              <th className={`${isMobile ? 'px-2 py-2.5' : 'px-4 py-3'} text-right font-semibold text-stone-600 dark:text-stone-400`}>
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

              if (row.rowType === 'groupHeader') {
                const { group } = row;
                const isExpanded = expandedGroups?.has(group.groupKey);
                // Compute running balance for the group: use last child's balance
                const lastChild = group.children[group.children.length - 1];
                const groupBalance = lastChild ? (balanceMap?.get(lastChild.id) ?? null) : null;
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
                    runningBalance={groupBalance}
                    isMobile={isMobile}
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
                  runningBalance={isChild ? null : (balanceMap?.get(tx.id) ?? null)}
                  onConfirm={onConfirm}
                  onSkip={onSkip}
                  onSplit={onSplit}
                  splitTransactionIds={splitTransactionIds}
                  isMobile={isMobile}
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
