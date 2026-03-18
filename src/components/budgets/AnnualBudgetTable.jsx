import { useEffect, useState, useCallback, Fragment, useMemo } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import { getCategoriesOffline as getCategories } from '../../services/offlineAware';
import { updateCategory, bulkUpdateSortOrder, getUserPreference, setUserPreference } from '../../services/categories';
import {
  getBudgetPlansForYear,
  createBudgetPlan,
  getBudgetItems,
  upsertBudgetItems,
  updateBudgetPlan,
  copyBudgetFromYear,
} from '../../services/budgets';
import {
  formatCurrency,
  toDollars,
  isSafeModeActive,
} from '../../utils/helpers';
import useAvailableYears from '../../hooks/useAvailableYears';
import useMonthYear from '../../hooks/useMonthYear';
import CategoryForm from './CategoryForm';
import Modal from '../common/Modal';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const SHORT_MONTHS = MONTHS.map((m) =>
  new Date(2000, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }),
);

const DEFAULT_TYPE_ORDER = ['income', 'needs', 'wants', 'savings'];

const TYPE_STYLES = {
  income: {
    label: 'Income',
    headerBg: 'bg-emerald-50 dark:bg-emerald-900/30',
    stickyBg: 'bg-emerald-50 dark:bg-emerald-950',
    headerText: 'text-emerald-800 dark:text-emerald-300',
    headerBorder: 'border-emerald-200/60 dark:border-emerald-700/60',
  },
  needs: {
    label: 'Needs',
    headerBg: 'bg-red-50 dark:bg-red-900/30',
    stickyBg: 'bg-red-50 dark:bg-red-950',
    headerText: 'text-red-800 dark:text-red-300',
    headerBorder: 'border-red-200/60 dark:border-red-700/60',
  },
  wants: {
    label: 'Wants',
    headerBg: 'bg-pink-50 dark:bg-pink-900/30',
    stickyBg: 'bg-pink-50 dark:bg-pink-950',
    headerText: 'text-pink-800 dark:text-pink-300',
    headerBorder: 'border-pink-200/60 dark:border-pink-700/60',
  },
  savings: {
    label: 'Savings',
    headerBg: 'bg-teal-50 dark:bg-teal-900/30',
    stickyBg: 'bg-teal-50 dark:bg-teal-950',
    headerText: 'text-teal-800 dark:text-teal-300',
    headerBorder: 'border-teal-200/60 dark:border-teal-700/60',
  },
};

// -- Sortable category row (used in edit mode) --
function SortableCategoryRow({ cat, months, monthData, isSaving, isEditMode, onCellChange, onEditCategory, onMobileEdit, onBulkFill, annualTotal }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cat.id, disabled: !isEditMode });
  const [focusedMonth, setFocusedMonth] = useState(null);
  const [editValue, setEditValue] = useState('');

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className="border-t border-stone-100 hover:bg-amber-50/30 dark:border-stone-700/50 dark:hover:bg-amber-900/10"
    >
      {/* Category name (sticky) */}
      <td className="sticky left-0 z-10 bg-white px-2 py-1 dark:bg-stone-800">
        <div className="flex items-center gap-1.5">
          {isEditMode && (
            <button
              type="button"
              className="cursor-grab touch-none text-stone-300 hover:text-stone-500"
              {...attributes}
              {...listeners}
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
              </svg>
            </button>
          )}
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ backgroundColor: cat.color }}
          />
          {isEditMode ? (
            <span className="max-w-[120px] truncate text-xs font-medium text-stone-800 dark:text-stone-200">
              {cat.name}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => onBulkFill(cat)}
              title="Set amount for all 12 months"
              className="max-w-[120px] truncate text-left text-xs font-medium text-stone-800 transition-colors hover:text-amber-600 dark:text-stone-200 dark:hover:text-amber-400"
            >
              {cat.name}
            </button>
          )}
          {isEditMode && (
            <button
              type="button"
              onClick={() => onEditCategory(cat)}
              className="ml-0.5 rounded p-0.5 text-stone-300 transition-colors hover:bg-stone-100 hover:text-amber-600"
              title="Edit category"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </button>
          )}
        </div>
      </td>

      {/* Month cells */}
      {months.map((m) => {
        const cents = monthData[m]?.allocations[cat.id] || 0;
        const exactDollars = cents ? toDollars(cents, { raw: true }).toFixed(2) : '';
        const roundedDollars = cents ? String(Math.round(toDollars(cents, { raw: true }))) : '';
        const displayDollars = (isSafeModeActive() && cents) ? Math.round(toDollars(cents)) : roundedDollars;
        // While this cell is focused, show the raw typed string; otherwise show rounded whole dollars
        const inputValue = focusedMonth === m ? editValue : roundedDollars;
        return (
          <td key={m} className="px-0.5 py-0.5">
            {/* Mobile: read-only tap target */}
            <button
              type="button"
              onClick={() => onMobileEdit(m, cat.id, exactDollars)}
              className="flex sm:hidden w-full items-center justify-end rounded border border-stone-200 bg-stone-50/30 px-1 py-1.5 text-right text-[11px] text-stone-800 dark:border-stone-700 dark:bg-stone-700/30 dark:text-stone-200"
            >
              {roundedDollars === '' ? <span className="text-stone-300 dark:text-stone-600">—</span> : `$${displayDollars}`}
            </button>
            {/* Desktop: editable input */}
            <div className="relative hidden sm:block">
              <span className="pointer-events-none absolute inset-y-0 left-1 flex items-center text-[10px] text-stone-300">
                $
              </span>
              <input
                type="text"
                inputMode="decimal"
                value={inputValue}
                onChange={(e) => {
                  setEditValue(e.target.value);
                  onCellChange(m, cat.id, e.target.value);
                }}
                onFocus={(e) => {
                  setFocusedMonth(m);
                  setEditValue(exactDollars);
                  const target = e.target;
                  setTimeout(() => target.select(), 0);
                }}
                onBlur={() => {
                  setFocusedMonth(null);
                  setEditValue('');
                }}
                disabled={isSaving}
                placeholder="0"
                className="w-full rounded border border-stone-200 bg-stone-50/30 py-1 pl-4 pr-0.5 text-right text-[11px] text-stone-800 placeholder-stone-300 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-700/30 dark:text-stone-200 dark:placeholder-stone-500 dark:focus:bg-stone-700"
              />
            </div>
          </td>
        );
      })}

      {/* Annual total */}
      <td className="px-2 py-1 text-right text-[11px] font-semibold text-stone-700 dark:text-stone-300">
        {formatCurrency(annualTotal, 'USD', { hideCents: true })}
      </td>
    </tr>
  );
}

// -- Sortable type group header --
function SortableGroupHeader({ type, isEditMode, listeners, attributes }) {
  const typeStyle = TYPE_STYLES[type];
  if (!typeStyle) return null;

  return (
    <tr className={typeStyle.headerBg}>
      <td
        className={`sticky left-0 z-10 border-t ${typeStyle.headerBorder} ${typeStyle.stickyBg} px-2 py-1.5`}
      >
        <div className="flex items-center gap-2">
          {isEditMode && (
            <button
              type="button"
              className="cursor-grab touch-none text-stone-400 hover:text-stone-600"
              {...attributes}
              {...listeners}
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 2a2 2 0 10.001 4.001A2 2 0 007 2zm0 6a2 2 0 10.001 4.001A2 2 0 007 8zm0 6a2 2 0 10.001 4.001A2 2 0 007 14zm6-8a2 2 0 10-.001-4.001A2 2 0 0013 6zm0 2a2 2 0 10.001 4.001A2 2 0 0013 8zm0 6a2 2 0 10.001 4.001A2 2 0 0013 14z" />
              </svg>
            </button>
          )}
          <span className={`text-xs font-bold uppercase tracking-wider ${typeStyle.headerText}`}>
            {typeStyle.label}
          </span>
        </div>
      </td>
      <td colSpan={MONTHS.length + 1} className={`border-t ${typeStyle.headerBorder} ${typeStyle.headerBg}`} />
    </tr>
  );
}

// -- Wrapper for sortable group (header + category rows) --
function SortableTypeGroup({ type, groupId, isEditMode, categories: cats, months, monthData, isSaving, onCellChange, onEditCategory, onMobileEdit, onBulkFill }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: groupId, disabled: !isEditMode });

  const groupStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const catIds = useMemo(() => cats.map((c) => c.id), [cats]);

  return (
    <Fragment>
      <tbody ref={setNodeRef} style={groupStyle}>
        <SortableGroupHeader
          type={type}
          isEditMode={isEditMode}
          listeners={listeners}
          attributes={attributes}
        />
        <SortableContext items={catIds} strategy={verticalListSortingStrategy}>
          {cats.map((cat) => {
            const annualTotal = MONTHS.reduce(
              (sum, m) => sum + (monthData[m]?.allocations[cat.id] || 0),
              0,
            );
            return (
              <SortableCategoryRow
                key={cat.id}
                cat={cat}
                months={months}
                monthData={monthData}
                isSaving={isSaving}
                isEditMode={isEditMode}
                onCellChange={onCellChange}
                onEditCategory={onEditCategory}
                onMobileEdit={onMobileEdit}
                onBulkFill={onBulkFill}
                annualTotal={annualTotal}
              />
            );
          })}
        </SortableContext>
      </tbody>
    </Fragment>
  );
}

/**
 * Annual budget table - all 12 months in a spreadsheet-like grid.
 * 
 * Features:
 * - Full-width colored type group headers
 * - Sticky thead for vertical scroll
 * - Compact layout to fit 1080p without horizontal scroll
 * - Hidden cents (display rounded dollars)
 * - Drag-and-drop reordering (categories within groups + group order)
 * - Inline category editing (name, color, type) via modal
 */
export default function AnnualBudgetTable() {
  const { month: ctxMonth, year: ctxYear, setMonthYear } = useMonthYear();

  const [year, setYear] = useState(ctxYear);
  const [categories, setCategories] = useState([]);
  const [typeOrder, setTypeOrder] = useState(DEFAULT_TYPE_ORDER);
  const [monthData, setMonthData] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [copyOverwrite, setCopyOverwrite] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingCategory, setEditingCategory] = useState(null);
  const [mobileEditCell, setMobileEditCell] = useState({ open: false, categoryId: null, month: null, value: '' });
  const [bulkFillCell, setBulkFillCell] = useState({ open: false, categoryId: null, categoryName: '', categoryColor: null, value: '', overwriteExisting: true });

  const openMobileEdit = (month, categoryId, dollars) => {
    setMobileEditCell({ open: true, categoryId, month, value: dollars === '' ? '' : String(dollars) });
  };
  const closeMobileEdit = () => setMobileEditCell({ open: false, categoryId: null, month: null, value: '' });
  const handleMobileSave = () => {
    handleCellChange(mobileEditCell.month, mobileEditCell.categoryId, mobileEditCell.value);
    closeMobileEdit();
  };

  const openBulkFill = (cat) => {
    const existingCents = MONTHS
      .map((m) => monthData[m]?.allocations[cat.id] || 0)
      .filter((v) => v > 0);
    let defaultValue = '';
    if (existingCents.length > 0) {
      const freq = {};
      existingCents.forEach((v) => { freq[v] = (freq[v] || 0) + 1; });
      const mode = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
      defaultValue = String(Math.round(toDollars(mode, { raw: true })));
    }
    setBulkFillCell({ open: true, categoryId: cat.id, categoryName: cat.name, categoryColor: cat.color, value: defaultValue, overwriteExisting: true });
  };
  const closeBulkFill = () => setBulkFillCell((prev) => ({ ...prev, open: false }));
  const handleBulkFillSave = () => {
    const { categoryId, value, overwriteExisting } = bulkFillCell;
    MONTHS.forEach((m) => {
      if (!overwriteExisting) {
        const existing = monthData[m]?.allocations[categoryId] || 0;
        if (existing > 0) return;
      }
      handleCellChange(m, categoryId, value);
    });
    closeBulkFill();
  };

  const { years } = useAvailableYears();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ---------- load data ----------
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError('');
    setSuccess('');
    try {
      const [cats, plans, savedTypeOrder] = await Promise.all([
        getCategories(),
        getBudgetPlansForYear(year),
        getUserPreference('type_group_order').catch(() => null),
      ]);
      setCategories(cats);

      if (savedTypeOrder && Array.isArray(savedTypeOrder)) {
        const validTypes = new Set(DEFAULT_TYPE_ORDER);
        const filtered = savedTypeOrder.filter((t) => validTypes.has(t));
        const missing = DEFAULT_TYPE_ORDER.filter((t) => !filtered.includes(t));
        setTypeOrder([...filtered, ...missing]);
      }

      const entries = await Promise.all(
        plans.map(async (p) => {
          const items = await getBudgetItems(p.id);
          const alloc = {};
          items.forEach((item) => {
            alloc[item.category_id] = item.planned_amount;
          });
          return [p.month, { planId: p.id, allocations: alloc }];
        }),
      );

      const md = {};
      MONTHS.forEach((m) => {
        const alloc = {};
        cats.forEach((c) => { alloc[c.id] = 0; });
        md[m] = { planId: null, allocations: alloc };
      });
      entries.forEach(([m, data]) => {
        md[m] = {
          planId: data.planId,
          allocations: { ...md[m].allocations, ...data.allocations },
        };
      });

      setMonthData(md);
    } catch (err) {
      setError(err.message || 'Failed to load annual budget data');
    } finally {
      setIsLoading(false);
    }
  }, [year]);

  useEffect(() => { loadData(); }, [loadData]);

  // ---------- handlers ----------
  const handleCellChange = (month, categoryId, value) => {
    const raw = value;
    let cents = 0;
    if (raw !== '' && raw !== '0') {
      const parsed = parseFloat(raw);
      if (Number.isNaN(parsed) || parsed < 0) return;
      cents = Math.round(parsed * 100);
    }
    setMonthData((prev) => ({
      ...prev,
      [month]: {
        ...prev[month],
        allocations: {
          ...prev[month].allocations,
          [categoryId]: cents,
        },
      },
    }));
  };

  const handleSaveAll = async () => {
    setError('');
    setSuccess('');
    setIsSaving(true);

    try {
      for (const m of MONTHS) {
        const md = monthData[m];
        if (!md) continue;

        const alloc = md.allocations;
        const hasData = Object.values(alloc).some((v) => v > 0);
        if (!hasData && !md.planId) continue;

        let planId = md.planId;

        const incomeCIds = new Set(
          categories.filter((c) => c.type === 'income').map((c) => c.id),
        );
        const totalIncome = Object.entries(alloc)
          .filter(([id]) => incomeCIds.has(id))
          .reduce((sum, [, cents]) => sum + (cents || 0), 0);

        if (!planId) {
          const newPlan = await createBudgetPlan({ month: m, year, total_income: totalIncome });
          planId = newPlan.id;
          setMonthData((prev) => ({
            ...prev,
            [m]: { ...prev[m], planId },
          }));
        } else {
          await updateBudgetPlan(planId, { total_income: totalIncome });
        }

        const items = Object.entries(alloc).map(([category_id, planned_amount]) => ({
          budget_plan_id: planId,
          category_id,
          planned_amount: planned_amount || 0,
        }));
        await upsertBudgetItems(items);
      }

      setSuccess('All budgets saved successfully!');
    } catch (err) {
      setError(err.message || 'Failed to save budgets');
    } finally {
      setIsSaving(false);
    }
  };

  // ---------- copy from prior year ----------
  const handleCopyFromPriorYear = async () => {
    setIsCopying(true);
    setError('');
    setSuccess('');
    try {
      const sourceYear = year - 1;
      const { monthsCopied, monthsSkipped } = await copyBudgetFromYear(sourceYear, year, { overwrite: copyOverwrite });
      if (monthsCopied === 0 && monthsSkipped > 0) {
        setSuccess(`All ${monthsSkipped} month${monthsSkipped !== 1 ? 's' : ''} already had a budget — nothing was copied. Enable "Overwrite" to replace existing months.`);
      } else if (monthsCopied === 0) {
        setSuccess(`No budget data found for ${sourceYear}.`);
      } else {
        const skippedNote = monthsSkipped > 0 ? ` (${monthsSkipped} existing month${monthsSkipped !== 1 ? 's' : ''} skipped)` : '';
        setSuccess(`Copied ${monthsCopied} month${monthsCopied !== 1 ? 's' : ''} from ${sourceYear}${skippedNote}.`);
      }
      setShowCopyModal(false);
      setCopyOverwrite(false);
      await loadData();
    } catch (err) {
      setError(err.message || 'Copy failed.');
      setShowCopyModal(false);
    } finally {
      setIsCopying(false);
    }
  };

  // ---------- category editing ----------
  const handleEditCategory = (cat) => { setEditingCategory(cat); };

  const handleUpdateCategory = async (values) => {
    const updated = await updateCategory(editingCategory.id, values);
    setCategories((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    setEditingCategory(null);
  };

  // ---------- drag-and-drop ----------
  const handleDragEnd = async (event) => {
    const { active, over } = event;
    if (!active || !over || active.id === over.id) return;

    const activeStr = String(active.id);
    const overStr = String(over.id);

    // Type group drag
    if (activeStr.startsWith('group-') && overStr.startsWith('group-')) {
      const activeType = activeStr.replace('group-', '');
      const overType = overStr.replace('group-', '');
      const oldIndex = typeOrder.indexOf(activeType);
      const newIndex = typeOrder.indexOf(overType);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(typeOrder, oldIndex, newIndex);
        setTypeOrder(newOrder);
        try { await setUserPreference('type_group_order', newOrder); }
        catch (err) { console.error('Failed to save type order:', err); }
      }
      return;
    }

    // Category drag within a group
    const activeCat = categories.find((c) => c.id === active.id);
    const overCat = categories.find((c) => c.id === over.id);
    if (!activeCat || !overCat || activeCat.type !== overCat.type) return;

    const type = activeCat.type;
    const typeCats = categories.filter((c) => c.type === type);
    const oldIndex = typeCats.findIndex((c) => c.id === active.id);
    const newIndex = typeCats.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(typeCats, oldIndex, newIndex);
    const updates = reordered.map((c, i) => ({ id: c.id, sort_order: i }));

    setCategories((prev) => {
      const otherCats = prev.filter((c) => c.type !== type);
      const updatedTypeCats = reordered.map((c, i) => ({ ...c, sort_order: i }));
      return [...otherCats, ...updatedTypeCats];
    });

    try { await bulkUpdateSortOrder(updates); }
    catch (err) { console.error('Failed to save category order:', err); }
  };

  // ---------- group categories ----------
  const budgetableCategories = categories.filter((c) => c.type !== 'transfer');

  const grouped = useMemo(() => {
    const g = {};
    typeOrder.forEach((t) => { g[t] = []; });
    budgetableCategories.forEach((c) => {
      if (g[c.type]) g[c.type].push(c);
    });
    Object.values(g).forEach((arr) => arr.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)));
    return g;
  }, [budgetableCategories, typeOrder]);

  const incomeCatIds = new Set(
    categories.filter((c) => c.type === 'income').map((c) => c.id),
  );
  const transferCatIds = new Set(
    categories.filter((c) => c.type === 'transfer').map((c) => c.id),
  );

  const getMonthIncome = (m) => {
    if (!monthData[m]) return 0;
    return Object.entries(monthData[m].allocations)
      .filter(([id]) => incomeCatIds.has(id))
      .reduce((s, [, v]) => s + (v || 0), 0);
  };

  const getMonthExpenses = (m) => {
    if (!monthData[m]) return 0;
    return Object.entries(monthData[m].allocations)
      .filter(([id]) => !incomeCatIds.has(id) && !transferCatIds.has(id))
      .reduce((s, [, v]) => s + (v || 0), 0);
  };

  const groupIds = useMemo(() => typeOrder.map((t) => `group-${t}`), [typeOrder]);

  // ---------- hide unbudgeted rows in normal view ----------
  const budgetedCategoryIds = useMemo(() => {
    const ids = new Set();
    Object.values(monthData).forEach(({ allocations }) => {
      Object.entries(allocations).forEach(([id, val]) => {
        if (val && val !== 0) ids.add(id);
      });
    });
    return ids;
  }, [monthData]);

  const visibleGrouped = useMemo(() => {
    if (isEditMode) return grouped;
    const g = {};
    typeOrder.forEach((t) => {
      g[t] = (grouped[t] || []).filter((c) => budgetedCategoryIds.has(c.id));
    });
    return g;
  }, [grouped, isEditMode, budgetedCategoryIds, typeOrder]);

  const hiddenCount = useMemo(() => {
    if (isEditMode) return 0;
    return budgetableCategories.filter((c) => !budgetedCategoryIds.has(c.id)).length;
  }, [isEditMode, budgetableCategories, budgetedCategoryIds]);

  // ---------- render ----------
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Year selector + Edit mode + Import */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { const ny = year - 1; setYear(ny); setMonthYear(ctxMonth, ny); }}
          className="rounded-lg border border-stone-200 bg-white p-2 text-stone-500 shadow-sm transition-all hover:bg-stone-50 hover:text-stone-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-300"
          aria-label="Previous year"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>

        <select
          value={year}
          onChange={(e) => { const ny = Number(e.target.value); setYear(ny); setMonthYear(ctxMonth, ny); }}
          className="rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2 text-sm font-semibold text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:focus:bg-stone-700"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => { const ny = year + 1; setYear(ny); setMonthYear(ctxMonth, ny); }}
          className="rounded-lg border border-stone-200 bg-white p-2 text-stone-500 shadow-sm transition-all hover:bg-stone-50 hover:text-stone-700 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-300"
          aria-label="Next year"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>

        {/* Edit Layout toggle */}
        <button
          type="button"
          onClick={() => setIsEditMode((prev) => !prev)}
          className={`hidden sm:flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
            isEditMode
              ? 'bg-amber-500 text-white shadow-md shadow-amber-200/50 hover:bg-amber-600 dark:shadow-amber-900/30'
              : 'border border-stone-200 bg-white text-stone-600 hover:bg-stone-50 hover:shadow-md dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700'
          }`}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </svg>
          {isEditMode ? 'Done Editing' : 'Edit Layout'}
        </button>

        {/* Copy from Prior Year button */}
        <button
          type="button"
          onClick={() => setShowCopyModal(true)}
          className="ml-auto flex items-center gap-2 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Copy from {year - 1}
        </button>

      </div>

      {isEditMode && (
        <div className="animate-fade-in rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400">
          Drag to reorder categories and type groups. Click the pencil icon to edit a category.
        </div>
      )}

      {!isEditMode && hiddenCount > 0 && (
        <div className="animate-fade-in flex items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2 text-xs text-stone-500 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-400">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
          </svg>
          {hiddenCount} unbudgeted {hiddenCount === 1 ? 'category' : 'categories'} hidden — enable <button type="button" onClick={() => setIsEditMode(true)} className="mx-0.5 font-medium text-amber-600 underline underline-offset-2 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300">Edit Layout</button> to view all.
        </div>
      )}

      {/* Alerts */}
      {error && (
        <div className="animate-fade-in rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          <span className="mr-1.5">&#9888;</span>{error}
        </div>
      )}
      {success && (
        <div className="animate-fade-in rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400">
          <span className="mr-1.5">&#10003;</span>{success}
        </div>
      )}

      {/* Scrollable table with sticky header */}
      <div className="overflow-y-auto overflow-x-auto rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" style={{ maxHeight: 'calc(100vh - 260px)' }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth: '900px' }}>
            <thead className="sticky top-0 z-20 bg-stone-50 shadow-sm dark:bg-stone-900">
              <tr className="border-b border-stone-200 dark:border-stone-700">
                <th className="sticky left-0 z-30 bg-stone-50 px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:bg-stone-900 dark:text-stone-400" style={{ minWidth: '130px' }}>
                  Category
                </th>
                {MONTHS.map((m, i) => (
                  <th
                    key={m}
                    className="px-0.5 py-2 text-center text-[10px] font-semibold uppercase text-stone-500 dark:text-stone-400"
                    style={{ minWidth: '52px' }}
                  >
                    {SHORT_MONTHS[i]}
                  </th>
                ))}
                <th className="px-2 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400" style={{ minWidth: '70px' }}>
                  Annual
                </th>
              </tr>
            </thead>

            <SortableContext items={groupIds} strategy={verticalListSortingStrategy}>
              {typeOrder.map((type) => {
                const cats = visibleGrouped[type];
                if (!cats || cats.length === 0) return null;

                return (
                  <SortableTypeGroup
                    key={type}
                    type={type}
                    groupId={`group-${type}`}
                    isEditMode={isEditMode}
                    categories={cats}
                    months={MONTHS}
                    monthData={monthData}
                    isSaving={isSaving}
                    onCellChange={handleCellChange}
                    onEditCategory={handleEditCategory}
                    onMobileEdit={openMobileEdit}
                    onBulkFill={openBulkFill}
                  />
                );
              })}
            </SortableContext>

            {/* Footer totals */}
            <tfoot className="sticky bottom-0 z-20 bg-stone-50 shadow-[0_-1px_3px_rgba(0,0,0,0.05)] dark:bg-stone-900">
              <tr className="border-t-2 border-stone-300 dark:border-stone-600">
                <td className="sticky left-0 z-30 bg-stone-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-600 dark:bg-stone-900 dark:text-stone-400">
                  Income
                </td>
                {MONTHS.map((m) => (
                  <td key={m} className="px-0.5 py-1.5 text-center text-[11px] font-semibold text-emerald-700">
                    {formatCurrency(getMonthIncome(m), 'USD', { hideCents: true })}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-emerald-700">
                  {formatCurrency(MONTHS.reduce((s, m) => s + getMonthIncome(m), 0), 'USD', { hideCents: true })}
                </td>
              </tr>
              <tr>
                <td className="sticky left-0 z-30 bg-stone-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-600 dark:bg-stone-900 dark:text-stone-400">
                  Expenses
                </td>
                {MONTHS.map((m) => (
                  <td key={m} className="px-0.5 py-1.5 text-center text-[11px] font-semibold text-stone-700 dark:text-stone-300">
                    {formatCurrency(getMonthExpenses(m), 'USD', { hideCents: true })}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right text-[11px] font-bold text-stone-700 dark:text-stone-300">
                  {formatCurrency(MONTHS.reduce((s, m) => s + getMonthExpenses(m), 0), 'USD', { hideCents: true })}
                </td>
              </tr>
              <tr>
                <td className="sticky left-0 z-30 bg-stone-50 px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-600 dark:bg-stone-900 dark:text-stone-400">
                  Remaining
                </td>
                {MONTHS.map((m) => {
                  const rem = getMonthIncome(m) - getMonthExpenses(m);
                  return (
                    <td
                      key={m}
                      className={`px-0.5 py-1.5 text-center text-[11px] font-semibold ${rem >= 0 ? 'text-emerald-600' : 'text-red-600'}`}
                    >
                      {formatCurrency(rem, 'USD', { hideCents: true })}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-right text-[11px] font-bold">
                  {(() => {
                    const total = MONTHS.reduce(
                      (s, m) => s + getMonthIncome(m) - getMonthExpenses(m),
                      0,
                    );
                    return (
                      <span className={total >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                        {formatCurrency(total, 'USD', { hideCents: true })}
                      </span>
                    );
                  })()}
                </td>
              </tr>
            </tfoot>
          </table>
        </DndContext>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSaveAll}
          disabled={isSaving}
          className="rounded-xl bg-amber-500 px-8 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving all months...' : 'Save All Months'}
        </button>
      </div>

      {/* Copy from prior year confirmation modal */}
      {showCopyModal && (
        <div data-modal-open="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-stone-200/60 bg-white p-6 shadow-2xl shadow-stone-900/10 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                Copy Budget from {year - 1}
              </h2>
              <button
                type="button"
                onClick={() => { setShowCopyModal(false); setCopyOverwrite(false); }}
                className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="mb-4 text-sm text-stone-600 dark:text-stone-300">
              Copy all planned amounts from <span className="font-semibold">{year - 1}</span> into{' '}
              <span className="font-semibold">{year}</span>. This uses last year&apos;s budget as a
              starting point — you can adjust individual cells afterwards.
            </p>

            {/* Overwrite toggle */}
            <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-700 dark:bg-stone-700/30">
              <input
                type="checkbox"
                checked={copyOverwrite}
                onChange={(e) => setCopyOverwrite(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-amber-500"
              />
              <span className="text-sm text-stone-700 dark:text-stone-300">
                <span className="font-semibold">Overwrite existing months</span>
                <span className="ml-1 text-stone-500 dark:text-stone-400">
                  — replace {year} months that already have a budget plan.
                  When unchecked, only empty months are filled.
                </span>
              </span>
            </label>

            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowCopyModal(false); setCopyOverwrite(false); }}
                className="rounded-lg border border-stone-200 bg-white px-5 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCopyFromPriorYear}
                disabled={isCopying}
                className="flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-2 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98] disabled:opacity-60"
              >
                {isCopying && (
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                )}
                {isCopying ? 'Copying…' : `Copy from ${year - 1}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile cell edit modal */}
      {mobileEditCell.open && (() => {
        const mobileCat = categories.find((c) => c.id === mobileEditCell.categoryId);
        const mobileMonthName = mobileEditCell.month ? SHORT_MONTHS[mobileEditCell.month - 1] : '';
        return (
          <div data-modal-open="true" className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4">
            <div className="w-full max-w-sm rounded-2xl border border-stone-200/60 bg-white p-6 shadow-2xl dark:border-stone-700/60 dark:bg-stone-800">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {mobileCat?.name} — {mobileMonthName}
                </h2>
                <button
                  type="button"
                  onClick={closeMobileEdit}
                  className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-stone-700"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="relative mb-5">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-400 dark:text-stone-500">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={mobileEditCell.value}
                  onChange={(e) => setMobileEditCell((prev) => ({ ...prev, value: e.target.value }))}
                  onFocus={(e) => e.target.select()}
                  autoFocus
                  placeholder="0"
                  className="w-full rounded-xl border border-stone-200 bg-stone-50 py-3 pl-8 pr-4 text-right text-base text-stone-800 placeholder-stone-300 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-stone-700 dark:bg-stone-700/50 dark:text-stone-200 dark:focus:bg-stone-700"
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={closeMobileEdit}
                  className="flex-1 rounded-xl border border-stone-200 bg-white py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleMobileSave}
                  className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Bulk fill modal */}
      {bulkFillCell.open && (
        <div data-modal-open="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-stone-200/60 bg-white p-6 shadow-2xl shadow-stone-900/10 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: bulkFillCell.categoryColor }} />
                <h2 className="text-base font-semibold text-stone-900 dark:text-stone-100">
                  {bulkFillCell.categoryName}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeBulkFill}
                className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:hover:bg-stone-700 dark:hover:text-stone-300"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">
              Set a monthly budget for all 12 months of{' '}
              <span className="font-semibold text-stone-700 dark:text-stone-300">{year}</span>.
            </p>
            <div className="relative mb-4">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-stone-400 dark:text-stone-500">$</span>
              <input
                type="number"
                step="1"
                min="0"
                value={bulkFillCell.value}
                onChange={(e) => setBulkFillCell((prev) => ({ ...prev, value: e.target.value }))}
                onKeyDown={(e) => { if (e.key === 'Enter') handleBulkFillSave(); }}
                onFocus={(e) => e.target.select()}
                autoFocus
                placeholder="0"
                className="w-full rounded-xl border border-stone-200 bg-stone-50 py-3 pl-8 pr-4 text-right text-base text-stone-800 placeholder-stone-300 focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-stone-700 dark:bg-stone-700/50 dark:text-stone-200 dark:placeholder-stone-500 dark:focus:bg-stone-700"
              />
            </div>
            <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-stone-50/60 p-3 dark:border-stone-700 dark:bg-stone-700/30">
              <input
                type="checkbox"
                checked={bulkFillCell.overwriteExisting}
                onChange={(e) => setBulkFillCell((prev) => ({ ...prev, overwriteExisting: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded accent-amber-500"
              />
              <span className="text-sm text-stone-700 dark:text-stone-300">
                <span className="font-semibold">Overwrite existing months</span>
                <span className="ml-1 text-stone-500 dark:text-stone-400">
                  — when unchecked, only empty months are filled.
                </span>
              </span>
            </label>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={closeBulkFill}
                className="flex-1 rounded-xl border border-stone-200 bg-white py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkFillSave}
                className="flex-1 rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
              >
                Apply to All Months
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit category modal */}
      {editingCategory && (
        <Modal title="Edit Category" onClose={() => setEditingCategory(null)}>
          <CategoryForm
            initialValues={editingCategory}
            onSubmit={handleUpdateCategory}
            onCancel={() => setEditingCategory(null)}
            isEditing
          />
        </Modal>
      )}
    </div>
  );
}
