import { useEffect, useState, useCallback } from "react";
import {
  getSplitExpenses,
  getLastSeenSplitsAt,
  markSplitsSeenLocal,
} from "../services/splitExpenses";
import { markSplitsSeenDB } from "../services/partnerships";

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
  const [allPartnerExpenses, setAllPartnerExpenses] = useState([]);
  const [unseenExpenses, setUnseenExpenses] = useState([]);
  const [fetchedForKey, setFetchedForKey] = useState(null);

  const active = !!(partnership?.id && currentUserId);
  const fetchKey = active ? `${partnership.id}:${currentUserId}` : null;

  // DB-side seen_at for this user (comes from the already-loaded partnership object)
  const dbSeenAt = active
    ? (isUserA ? partnership.user_a_seen_at : partnership.user_b_seen_at) ?? null
    : null;

  useEffect(() => {
    if (!partnership?.id || !currentUserId) return;

    let cancelled = false;
    const key = `${partnership.id}:${currentUserId}`;

    getSplitExpenses(partnership.id)
      .then((expenses) => {
        if (cancelled) return;

        const partnerAdded = expenses.filter(
          (e) => e.paid_by_user_id !== currentUserId,
        );

        const lastSeenAt = getLastSeenSplitsAt(currentUserId, dbSeenAt);
        const lastSeenMs = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
        const unseen = !isNaN(lastSeenMs)
          ? partnerAdded.filter((e) => Date.parse(e.created_at) > lastSeenMs)
          : partnerAdded;

        setAllPartnerExpenses(partnerAdded);
        setUnseenExpenses(unseen);
        setFetchedForKey(key);
      })
      .catch(() => {
        if (!cancelled) setFetchedForKey(key);
      });

    return () => {
      cancelled = true;
    };
  // dbSeenAt is intentionally excluded — we only want to re-fetch expenses when
  // the partnership or user changes, not when the seen timestamp updates locally.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partnership?.id, currentUserId]);

  const markAsSeen = useCallback(() => {
    if (!currentUserId || !partnership?.id) return;
    // Write to localStorage immediately (offline fallback)
    markSplitsSeenLocal(currentUserId);
    // Persist to DB (fire-and-forget; non-critical)
    markSplitsSeenDB(partnership.id, isUserA).catch(() => {});
    setUnseenExpenses([]);
  }, [currentUserId, partnership?.id, isUserA]);

  return {
    unseenCount: active ? unseenExpenses.length : 0,
    unseenExpenses: active ? unseenExpenses : [],
    allPartnerExpenses: active ? allPartnerExpenses : [],
    markAsSeen,
    loading: active && fetchedForKey !== fetchKey,
  };
}
