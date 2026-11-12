import { useCallback, useMemo, useState } from "react";
import {
  getLastSeenSplitsAt,
  markSplitsSeenLocal,
} from "../services/splitExpenses";
import { markSplitsSeenDB } from "../services/partnerships";
import { useSplitExpenses } from "./queries";

const EMPTY = [];

/**
 * Returns unseen split expenses added by the partner.
 *
 * "Unseen" = partner-added items with created_at > lastSeenAt (or all if never seen).
 *
 * Seen state uses a two-tier strategy:
 *   1. Primary: user_a_seen_at / user_b_seen_at on the partnership row (cross-device).
 *   2. Fallback: localStorage (offline / before the DB value loads).
 *
 * @param {{
 *   partnership: object|null,
 *   currentUserId: string|null,
 *   isUserA: boolean
 * }} params
 * @returns {{
 *   unseenCount: number,
 *   unseenExpenses: Array,
 *   allPartnerExpenses: Array,
 *   markAsSeen: function,
 *   loading: boolean
 * }}
 */
export default function useSplitNotifications({ partnership, currentUserId, isUserA }) {
  // Bumped by markAsSeen so the locally stored seen timestamp is re-read.
  const [, setSeenVersion] = useState(0);

  const active = !!(partnership?.id && currentUserId);
  const partnershipId = partnership?.id;

  // Shares the `["split_expenses", userId, partnershipId]` cache entry with
  // the Split Expenses page, so it is fetched once (not on every TopBar
  // mount) and refreshes whenever a split write invalidates that key.
  const expensesQuery = useSplitExpenses(partnershipId, currentUserId);
  const expenses = expensesQuery.data?.expenses;

  // DB-side seen_at for this user (comes from the already-loaded partnership object)
  const dbSeenAt = active
    ? (isUserA ? partnership.user_a_seen_at : partnership.user_b_seen_at) ?? null
    : null;

  // Most recent of the DB value and the localStorage fallback. Read on every
  // render (one cheap lookup) so a "seen" mark written elsewhere is honoured.
  const lastSeenAt = active ? getLastSeenSplitsAt(currentUserId, dbSeenAt) : null;

  const allPartnerExpenses = useMemo(
    () =>
      expenses
        ? expenses.filter((e) => e.paid_by_user_id !== currentUserId)
        : EMPTY,
    [expenses, currentUserId],
  );

  const unseenExpenses = useMemo(() => {
    const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
    return !isNaN(lastSeenMs)
      ? allPartnerExpenses.filter((e) => Date.parse(e.created_at) > lastSeenMs)
      : allPartnerExpenses;
  }, [allPartnerExpenses, lastSeenAt]);

  const markAsSeen = useCallback(() => {
    if (!currentUserId || !partnershipId) return;
    // Write to localStorage immediately (offline fallback)
    markSplitsSeenLocal(currentUserId);
    // Persist to DB (fire-and-forget; non-critical)
    markSplitsSeenDB(partnershipId, isUserA).catch(() => {});
    setSeenVersion((v) => v + 1);
  }, [currentUserId, partnershipId, isUserA]);

  return {
    unseenCount: active ? unseenExpenses.length : 0,
    unseenExpenses: active ? unseenExpenses : [],
    allPartnerExpenses: active ? allPartnerExpenses : [],
    markAsSeen,
    loading: active && expensesQuery.isLoading,
  };
}
