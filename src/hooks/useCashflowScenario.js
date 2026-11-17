import { useMemo } from "react";
import {
  useAccountBalanceHistory,
  useCardPayments,
  useUpcomingTransactions,
} from "./queries";
import { buildCashflowScenario, resolveAccountRoles } from "../utils/cashflowScenario";
import { cashflowDateRange } from "../utils/reportRules";
import { getTodayString, toCents } from "../utils/helpers";

export const CASHFLOW_RANGE_OPTIONS = [
  { key: "1m", label: "1M", pastMonths: 1, futureMonths: 1 },
  { key: "3m", label: "3M", pastMonths: 2, futureMonths: 1 },
  { key: "6m", label: "6M", pastMonths: 4, futureMonths: 2 },
  { key: "1y", label: "1Y", pastMonths: 9, futureMonths: 3 },
  { key: "all", label: "All", pastMonths: null, futureMonths: 6 },
];

/** Playground items keep `amount` as typed dollars; the engine wants cents. */
export function toEngineItems(items = []) {
  return items.map((item) => ({ ...item, amount: toCents(parseFloat(item.amount) || 0) }));
}

/**
 * Loads everything the cashflow scenario needs and runs the engine.
 *
 * Balances are fetched for every account that affects the answer — cash and
 * reserve accounts, cards and the accounts that pay them, accounts used by
 * test items — plus whatever is selected for the chart. The chart selection
 * only controls which lines are drawn.
 */
export default function useCashflowScenario({
  accounts = [],
  chartAccountIds = [],
  items = [],
  settings = {},
  range = "3m",
  projectedToDate = null,
  enabled = true,
}) {
  const todayStr = getTodayString();
  const { startDate, endDate } = useMemo(() => {
    const preset = CASHFLOW_RANGE_OPTIONS.find((o) => o.key === range) || CASHFLOW_RANGE_OPTIONS[1];
    return cashflowDateRange({
      todayStr,
      pastMonths: preset.pastMonths,
      futureMonths: preset.futureMonths,
      projectedToDate,
    });
  }, [range, todayStr, projectedToDate]);

  const openAccounts = useMemo(() => accounts.filter((a) => !a.closed_at), [accounts]);
  const roles = useMemo(
    () => resolveAccountRoles(openAccounts, settings.roles),
    [openAccounts, settings.roles],
  );

  const { fetchIds, cardIds } = useMemo(() => {
    const ids = new Set(chartAccountIds);
    const cards = [];
    for (const a of openAccounts) {
      const role = roles[a.id];
      if (role === "cash" || role === "reserve") ids.add(a.id);
      if (role === "card") {
        ids.add(a.id);
        cards.push(a.id);
        if (a.payment_account_id) ids.add(a.payment_account_id);
      }
    }
    for (const item of items) {
      if (item.enabled === false) continue;
      if (item.accountId) ids.add(item.accountId);
      if (item.toAccountId) ids.add(item.toAccountId);
    }
    const known = new Set(openAccounts.map((a) => a.id));
    return {
      fetchIds: [...ids].filter((id) => known.has(id)).sort(),
      cardIds: cards.sort(),
    };
  }, [chartAccountIds, openAccounts, roles, items]);

  const balanceQuery = useAccountBalanceHistory(
    { accountIds: fetchIds, startDate, endDate },
    { enabled },
  );
  const upcomingQuery = useUpcomingTransactions(
    { accountIds: fetchIds, endDate },
    { enabled },
  );
  const cardPaymentsQuery = useCardPayments(
    { accountIds: cardIds, startDate },
    { enabled },
  );

  const upcoming = useMemo(() => upcomingQuery.data ?? [], [upcomingQuery.data]);
  const engineItems = useMemo(() => toEngineItems(items), [items]);
  const cushion = settings.cushion ?? 0;

  const result = useMemo(() => {
    const series = balanceQuery.data ?? [];
    if (!series.length) return null;
    return buildCashflowScenario({
      accounts: openAccounts,
      series,
      transactions: [...upcoming, ...(cardPaymentsQuery.data ?? [])],
      items: engineItems,
      roleOverrides: settings.roles,
      cushion,
      todayStr,
    });
  }, [balanceQuery.data, openAccounts, upcoming, cardPaymentsQuery.data, engineItems, settings.roles, cushion, todayStr]);

  return {
    result,
    roles,
    upcoming,
    startDate,
    endDate,
    todayStr,
    isLoading: balanceQuery.isLoading || upcomingQuery.isLoading || cardPaymentsQuery.isLoading,
    error: balanceQuery.error || upcomingQuery.error || cardPaymentsQuery.error || null,
  };
}
