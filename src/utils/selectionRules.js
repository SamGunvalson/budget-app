/**
 * Pure selection rules for the transaction list (no React, no services).
 *
 * `selectedIds` can hold ids that the current filters hide, so everything
 * that acts on or reports the selection goes through these helpers.
 */

/**
 * The selected ids that are currently visible.
 *
 * @param {Set<string>} selectedIds
 * @param {Array<{id: string}>} visibleRows
 * @returns {Set<string>} in visible-row order
 */
export function visibleSelection(selectedIds, visibleRows) {
  const result = new Set();
  if (!selectedIds || selectedIds.size === 0) return result;
  for (const row of visibleRows ?? []) {
    if (selectedIds.has(row.id)) result.add(row.id);
  }
  return result;
}

/**
 * True when there is at least one visible row and every visible row is
 * selected. Compares membership, not set size.
 *
 * @param {Set<string>} selectedIds
 * @param {Array<{id: string}>} visibleRows
 * @returns {boolean}
 */
export function isAllVisibleSelected(selectedIds, visibleRows) {
  const rows = visibleRows ?? [];
  if (rows.length === 0) return false;
  return rows.every((row) => selectedIds.has(row.id));
}

/**
 * Selection after the select-all checkbox is toggled: clears when every
 * visible row is already selected (or nothing is visible), otherwise selects
 * exactly the visible rows.
 *
 * @param {Set<string>} selectedIds
 * @param {Array<{id: string}>} visibleRows
 * @returns {Set<string>}
 */
export function nextSelectAll(selectedIds, visibleRows) {
  const rows = visibleRows ?? [];
  if (rows.length === 0 || isAllVisibleSelected(selectedIds, rows)) {
    return new Set();
  }
  return new Set(rows.map((row) => row.id));
}

/**
 * Ids a bulk action should act on: an explicit Set/array of ids when the
 * caller supplies one, otherwise the whole selection. Anything else (e.g. a
 * click event passed by an `onClick`) is ignored.
 *
 * @param {Set<string>} selectedIds
 * @param {Set<string>|string[]|*} [override]
 * @returns {string[]}
 */
export function resolveBulkIds(selectedIds, override) {
  if (override instanceof Set || Array.isArray(override)) {
    return Array.from(override);
  }
  return Array.from(selectedIds);
}

/**
 * @param {Array<{id: string, status: string}>} transactions
 * @returns {Map<string, string>} id → status
 */
export function buildStatusMap(transactions) {
  return new Map((transactions ?? []).map((t) => [t.id, t.status]));
}

/**
 * True when any selected id belongs to a known transaction that is not
 * posted. Ids missing from the map are ignored.
 *
 * @param {Iterable<string>} selectedIds
 * @param {Map<string, string>} statusById
 * @returns {boolean}
 */
export function hasNonPostedSelection(selectedIds, statusById) {
  for (const id of selectedIds) {
    const status = statusById.get(id);
    if (status !== undefined && status !== "posted") return true;
  }
  return false;
}
