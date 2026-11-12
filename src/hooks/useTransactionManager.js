import { useState, useCallback } from "react";
import {
  updateTransactionOffline as updateTransaction,
  deleteTransactionOffline as deleteTransaction,
  updateAsymmetricTransferOffline as updateAsymmetricTransfer,
  updateTransferOffline as updateTransfer,
  updateLinkedTransferOffline as updateLinkedTransfer,
  updateAdjustmentOffline as updateAdjustment,
  bulkUpdateTransactionsOffline as bulkUpdateTransactions,
  bulkDeleteTransactionsOffline as bulkDeleteTransactions,
  confirmTransactionOffline as confirmTransaction,
  skipTransactionOffline as skipTransaction,
  bulkConfirmTransactionsOffline as bulkConfirmTransactions,
  bulkSkipTransactionsOffline as bulkSkipTransactions,
} from "../services/offlineAware";
import { nextSelectAll, resolveBulkIds } from "../utils/selectionRules";

/**
 * Reusable hook that encapsulates transaction list management:
 * sorting, selection, inline editing, bulk actions, and single CRUD.
 *
 * @param {{
 *   transactions: Array,
 *   setTransactions: Function,
 *   onError?: (msg: string) => void,
 *   onDataChanged?: () => void,
 * }} opts
 *
 * @returns {{
 *   sortColumn: string,
 *   sortDirection: string,
 *   handleSort: Function,
 *   selectedIds: Set,
 *   handleToggleSelect: Function,
 *   handleSelectAll: Function,
 *   pendingEdits: Map,
 *   isSavingEdits: boolean,
 *   handleCellEdit: Function,
 *   handleSaveAllEdits: Function,
 *   handleDiscardEdits: Function,
 *   isBulkBusy: boolean,
 *   handleBulkRecategorize: Function,
 *   handleBulkDelete: Function,
 *   editingTransaction: Object|null,
 *   setEditingTransaction: Function,
 *   deletingTransaction: Object|null,
 *   setDeletingTransaction: Function,
 *   isDeletingId: string|null,
 *   handleUpdate: Function,
 *   handleDeleteConfirm: Function,
 * }}
 */
export default function useTransactionManager({
  transactions,
  setTransactions,
  onError,
  onDataChanged,
}) {
  // Sort state
  const [sortColumn, setSortColumn] = useState("transaction_date");
  const [sortDirection, setSortDirection] = useState("desc");

  // Selection state
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Inline edit state: Map<id, { field: value, ... }>
  const [pendingEdits, setPendingEdits] = useState(new Map());
  const [isSavingEdits, setIsSavingEdits] = useState(false);

  // Bulk action state
  const [isBulkBusy, setIsBulkBusy] = useState(false);

  // Modal state
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [deletingTransaction, setDeletingTransaction] = useState(null);
  const [isDeletingId, setIsDeletingId] = useState(null);

  const reportError = (msg) => onError?.(msg);

  // ---------- Sort ----------
  const handleSort = useCallback(
    (column) => {
      if (column === sortColumn) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortColumn(column);
        setSortDirection(column === "transaction_date" ? "desc" : "asc");
      }
    },
    [sortColumn],
  );

  // ---------- Selection ----------
  const handleToggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(
    (visibleTransactions) => {
      const visible = visibleTransactions ?? transactions;
      // Compare membership, not size: the selection may hold rows that the
      // current filters hide.
      setSelectedIds(nextSelectAll(selectedIds, visible));
    },
    [transactions, selectedIds],
  );

  // ---------- Inline edits ----------
  const handleCellEdit = useCallback((id, field, value) => {
    setPendingEdits((prev) => {
      const next = new Map(prev);
      const existing = next.get(id) || {};
      next.set(id, { ...existing, [field]: value });
      return next;
    });
  }, []);

  const handleSaveAllEdits = async () => {
    if (pendingEdits.size === 0) return;
    setIsSavingEdits(true);
    try {
      const updates = Array.from(pendingEdits.entries()).map(
        ([id, fields]) => ({
          id,
          ...fields,
        }),
      );
      const results = await bulkUpdateTransactions(updates);
      setTransactions((prev) => {
        const map = new Map(results.map((r) => [r.id, r]));
        return prev.map((t) => map.get(t.id) || t);
      });
      setPendingEdits(new Map());
      onDataChanged?.();
    } catch (err) {
      reportError(err?.message || "Failed to save edits.");
    } finally {
      setIsSavingEdits(false);
    }
  };

  const handleDiscardEdits = () => setPendingEdits(new Map());

  // ---------- Bulk actions ----------
  // Each bulk handler takes an optional Set/array of ids to act on. Callers
  // whose list can be filtered pass the visible part of the selection so
  // hidden rows are never touched; without it the whole selection is used.
  const handleBulkRecategorize = async (categoryId, idsOverride) => {
    setIsBulkBusy(true);
    try {
      const ids = resolveBulkIds(selectedIds, idsOverride);
      const updates = ids.map((id) => ({ id, category_id: categoryId }));
      const results = await bulkUpdateTransactions(updates);
      setTransactions((prev) => {
        const map = new Map(results.map((r) => [r.id, r]));
        return prev.map((t) => map.get(t.id) || t);
      });
      setSelectedIds(new Set());
      onDataChanged?.();
    } catch (err) {
      reportError(err?.message || "Failed to re-categorize.");
    } finally {
      setIsBulkBusy(false);
    }
  };

  const handleBulkDelete = async (idsOverride) => {
    setIsBulkBusy(true);
    try {
      const ids = resolveBulkIds(selectedIds, idsOverride);
      const idSet = new Set(ids);
      await bulkDeleteTransactions(ids);
      setTransactions((prev) => prev.filter((t) => !idSet.has(t.id)));
      setSelectedIds(new Set());
      onDataChanged?.();
    } catch (err) {
      reportError(err?.message || "Failed to delete transactions.");
    } finally {
      setIsBulkBusy(false);
    }
  };

  // ---------- Single CRUD ----------
  const handleUpdate = async (values) => {
    const updated = await updateTransaction(editingTransaction.id, values);
    setTransactions((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t)),
    );
    setEditingTransaction(null);
    onDataChanged?.();
  };

  const handleUpdateTransfer = async (values) => {
    const [updatedOut, updatedIn] = await updateTransfer(
      editingTransaction.id,
      values,
    );
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === updatedOut.id) return updatedOut;
        if (t.id === updatedIn.id) return updatedIn;
        return t;
      }),
    );
    setEditingTransaction(null);
    onDataChanged?.();
  };

  const handleUpdateAsymmetricTransfer = async (values) => {
    const [updatedOut, updatedIn] = await updateAsymmetricTransfer(
      editingTransaction.id,
      values,
    );
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === updatedOut.id) return updatedOut;
        if (t.id === updatedIn.id) return updatedIn;
        return t;
      }),
    );
    setEditingTransaction(null);
    onDataChanged?.();
  };

  const handleUpdateLinkedTransfer = async (values) => {
    const [updatedMain, updatedCompanion] = await updateLinkedTransfer(
      editingTransaction.id,
      values,
    );
    setTransactions((prev) =>
      prev.map((t) => {
        if (t.id === updatedMain.id) return updatedMain;
        if (t.id === updatedCompanion.id) return updatedCompanion;
        return t;
      }),
    );
    setEditingTransaction(null);
    onDataChanged?.();
  };

  const handleUpdateAdjustment = async (values) => {
    const updated = await updateAdjustment(editingTransaction.id, values);
    setTransactions((prev) =>
      prev.map((t) => (t.id === updated.id ? updated : t)),
    );
    setEditingTransaction(null);
    onDataChanged?.();
  };

  const handleDeleteConfirm = async () => {
    if (!deletingTransaction) return;
    setIsDeletingId(deletingTransaction.id);
    try {
      const deletedIds = await deleteTransaction(deletingTransaction.id);
      const deletedSet = new Set(deletedIds);
      setTransactions((prev) => prev.filter((t) => !deletedSet.has(t.id)));
      setDeletingTransaction(null);
      onDataChanged?.();
    } catch (err) {
      reportError(err?.message || "Failed to delete transaction.");
    } finally {
      setIsDeletingId(null);
    }
  };

  // ---------- Confirm / Skip ----------
  // Resolves to true when the transaction was confirmed, false when it failed
  // (the error is reported through onError), so callers can skip follow-up work.
  const handleConfirm = async (id) => {
    try {
      const updated = await confirmTransaction(id);
      setTransactions((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t)),
      );
      onDataChanged?.();
      return true;
    } catch (err) {
      reportError(err?.message || "Failed to confirm transaction.");
      return false;
    }
  };

  const handleSkip = async (id) => {
    try {
      // Skipping one leg of a transfer also skips its unposted companion(s);
      // the wrapper returns every id it skipped.
      const skipped = new Set([id, ...(await skipTransaction(id))]);
      // Remove skipped (soft-deleted) transactions from local state
      setTransactions((prev) => prev.filter((t) => !skipped.has(t.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const skippedId of skipped) next.delete(skippedId);
        return next;
      });
      onDataChanged?.();
    } catch (err) {
      reportError(err?.message || "Failed to skip transaction.");
    }
  };

  const handleBulkConfirm = async (idsOverride) => {
    setIsBulkBusy(true);
    try {
      const ids = resolveBulkIds(selectedIds, idsOverride);
      const results = await bulkConfirmTransactions(ids);
      setTransactions((prev) => {
        const map = new Map(results.map((r) => [r.id, r]));
        return prev.map((t) => map.get(t.id) || t);
      });
      setSelectedIds(new Set());
      onDataChanged?.();
    } catch (err) {
      reportError(err?.message || "Failed to confirm transactions.");
    } finally {
      setIsBulkBusy(false);
    }
  };

  const handleBulkSkip = async (idsOverride) => {
    setIsBulkBusy(true);
    try {
      const ids = resolveBulkIds(selectedIds, idsOverride);
      // Includes companion legs that were skipped with the requested rows.
      const idSet = new Set([...ids, ...(await bulkSkipTransactions(ids))]);
      setTransactions((prev) => prev.filter((t) => !idSet.has(t.id)));
      setSelectedIds(new Set());
      onDataChanged?.();
    } catch (err) {
      reportError(err?.message || "Failed to skip transactions.");
    } finally {
      setIsBulkBusy(false);
    }
  };

  // Reset selection & edits (useful when parent data changes)
  const reset = useCallback(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
    setPendingEdits((prev) => (prev.size === 0 ? prev : new Map()));
    setEditingTransaction((prev) => (prev === null ? prev : null));
    setDeletingTransaction((prev) => (prev === null ? prev : null));
  }, []);

  return {
    // Sort
    sortColumn,
    sortDirection,
    handleSort,
    // Selection
    selectedIds,
    handleToggleSelect,
    handleSelectAll,
    // Inline edits
    pendingEdits,
    isSavingEdits,
    handleCellEdit,
    handleSaveAllEdits,
    handleDiscardEdits,
    // Bulk
    isBulkBusy,
    handleBulkRecategorize,
    handleBulkDelete,
    // Single CRUD modals
    editingTransaction,
    setEditingTransaction,
    deletingTransaction,
    setDeletingTransaction,
    isDeletingId,
    handleUpdate,
    handleUpdateTransfer,
    handleUpdateAsymmetricTransfer,
    handleUpdateLinkedTransfer,
    handleUpdateAdjustment,
    handleDeleteConfirm,
    // Confirm / Skip
    handleConfirm,
    handleSkip,
    handleBulkConfirm,
    handleBulkSkip,
    // Utility
    reset,
  };
}
