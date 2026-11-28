import { useCallback, useState } from 'react';
import CategoryDrillDown from '../components/reports/CategoryDrillDown';
import { CATEGORY_FALLBACK_COLOR } from '../constants/chartColors';
import { drillDownTransactions } from '../utils/reportAggregations';

const noop = () => {};

/**
 * Shared state and rendering for the Reports category drill-down: one
 * category at a time expands into the editable transaction list.
 *
 * @param {{
 *   transactions: Array,        // already limited to the report's period and settled rule
 *   categories: Array,          // all categories, for the recategorize picker
 *   setTransactions: Function,  // optimistic setter for the backing query cache
 *   onDataChanged?: () => void,
 *   resetKey: string,           // collapse the drill-down whenever this changes
 * }} options
 * @returns {{
 *   expandedId: string | null,
 *   toggle: (categoryId: string) => void,
 *   close: () => void,
 *   render: (categoryId: string, display?: { name?: string, color?: string }) => React.ReactNode,
 * }}
 */
export default function useCategoryDrillDown({
  transactions,
  categories,
  setTransactions,
  onDataChanged = noop,
  resetKey,
}) {
  const [expandedId, setExpandedId] = useState(null);

  // Collapse during render when the period changes (avoids an effect cascade).
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    if (expandedId !== null) setExpandedId(null);
  }

  const toggle = useCallback((categoryId) => {
    setExpandedId((prev) => (prev === categoryId ? null : categoryId));
  }, []);
  const close = useCallback(() => setExpandedId(null), []);

  const render = useCallback(
    (categoryId, { name, color } = {}) => (
      <CategoryDrillDown
        transactions={drillDownTransactions(transactions, categoryId)}
        categories={categories}
        categoryName={name || 'Unknown'}
        categoryColor={color || CATEGORY_FALLBACK_COLOR}
        onClose={close}
        onDataChanged={onDataChanged}
        setAllTransactions={setTransactions}
      />
    ),
    [transactions, categories, close, onDataChanged, setTransactions],
  );

  return { expandedId, toggle, close, render };
}
