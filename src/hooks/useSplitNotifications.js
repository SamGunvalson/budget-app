import { useEffect, useState, useCallback } from "react";
import {
  getSplitExpenses,
  markSplitsSeen,
  getLastSeenSplitsAt,
} from "../services/splitExpenses";

/**
 * Returns unseen split expenses added by the partner.
 *
 * "Unseen" = partner-added items with created_at > lastSeenAt (or all if never seen).
 * Seen state is persisted in localStorage keyed by userId.
 *
 * @param {{ partnership: object|null, currentUserId: string|null }} params
 * @returns {{ unseenCount: number, unseenExpenses: Array, markAsSeen: function, loading: boolean }}
 */
export default function useSplitNotifications({ partnership, currentUserId }) {
  const [unseenExpenses, setUnseenExpenses] = useState([]);
  // Track the key (partnershipId:userId) for which results are available.
  // loading is derived: true whenever the active key differs from the fetched key,
  // so no synchronous setState is needed inside the effect body.
  const [fetchedForKey, setFetchedForKey] = useState(null);

  const active = !!(partnership?.id && currentUserId);
  const fetchKey = active ? `${partnership.id}:${currentUserId}` : null;

  useEffect(() => {
    if (!partnership?.id || !currentUserId) return;

    let cancelled = false;
    const key = `${partnership.id}:${currentUserId}`;

    getSplitExpenses(partnership.id)
      .then((expenses) => {
        if (cancelled) return;
        const lastSeenAt = getLastSeenSplitsAt(currentUserId);
        const partnerAdded = expenses.filter(
          (e) => e.paid_by_user_id !== currentUserId,
        );
        const unseen = lastSeenAt
          ? partnerAdded.filter((e) => e.created_at > lastSeenAt)
          : partnerAdded;
        setUnseenExpenses(unseen);
        setFetchedForKey(key);
      })
      .catch(() => {
        if (!cancelled) setFetchedForKey(key);
      });

    return () => {
      cancelled = true;
    };
  }, [partnership?.id, currentUserId]);

  const markAsSeen = useCallback(() => {
    if (!currentUserId) return;
    markSplitsSeen(currentUserId);
    setUnseenExpenses([]);
  }, [currentUserId]);

  return {
    unseenCount: active ? unseenExpenses.length : 0,
    unseenExpenses: active ? unseenExpenses : [],
    markAsSeen,
    loading: active && fetchedForKey !== fetchKey,
  };
}
