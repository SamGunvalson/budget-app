// Pure cashflow-scenario engine for the Accounts → Cashflow tab.
//
// Takes the daily per-account balance series (from get_account_balance_history,
// which already includes pending and projected transactions), layers on
// hypothetical "what if" items, and settles credit cards that have a statement
// cycle configured: each statement's balance is paid in full from the paying
// account, replacing any projected placeholder payment.
//
// Everything is integer cents in *raw* account sign: assets are what you have,
// liabilities are what you owe (positive = owed). Callers convert for display.
// No imports, so it is cheap to unit test.

/** Default cashflow role per account type. */
export const DEFAULT_ROLE_BY_TYPE = {
  checking: "cash",
  savings: "reserve",
  credit_card: "card",
  retirement: "ignore",
  brokerage: "ignore",
  loan: "ignore",
  mortgage: "ignore",
};

const ASSET_TYPES = new Set(["checking", "savings", "retirement", "brokerage"]);
const ASSET_ROLES = new Set(["cash", "reserve", "ignore"]);
const LIABILITY_ROLES = new Set(["card", "ignore"]);

const isAssetType = (type) => ASSET_TYPES.has(type);

// ── Date helpers (YYYY-MM-DD strings, calendar arithmetic only) ─────────────

const pad = (n) => String(n).padStart(2, "0");

function daysInMonth(year, month1) {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Date string for `day` in the given month, clamped to the month's last day. */
export function clampedDate(year, month1, day) {
  // Normalize month overflow (e.g. month 13 → January next year).
  const y = year + Math.floor((month1 - 1) / 12);
  const m = ((((month1 - 1) % 12) + 12) % 12) + 1;
  return `${y}-${pad(m)}-${pad(Math.min(day, daysInMonth(y, m)))}`;
}

function parts(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  return { y, m };
}

/**
 * Statement cycles whose close date falls between `from` and `to` (inclusive).
 * Each cycle: { closeDate, dueDate, nextCloseDate }. The due date is in the
 * close month when the due day is later than the close day, otherwise in the
 * following month. (A statement must close inside the balance series for its
 * amount to be known, so earlier cycles are never useful.)
 */
export function statementCycles({ closeDay, dueDay, from, to }) {
  if (!closeDay || !dueDay || !from || !to) return [];
  const start = parts(from);
  const end = parts(to);
  const cycles = [];
  for (let i = start.y * 12 + start.m - 1; i <= end.y * 12 + end.m - 1; i += 1) {
    const y = Math.floor(i / 12);
    const m = (i % 12) + 1;
    const closeDate = clampedDate(y, m, closeDay);
    if (closeDate < from) continue;
    if (closeDate > to) break;
    const dueDate = dueDay > closeDay
      ? clampedDate(y, m, dueDay)
      : clampedDate(y, m + 1, dueDay);
    cycles.push({ closeDate, dueDate, nextCloseDate: clampedDate(y, m + 1, closeDay) });
  }
  return cycles;
}

// ── Roles ───────────────────────────────────────────────────────────────────

/**
 * Resolve each account's cashflow role: 'cash' | 'reserve' | 'card' | 'ignore'.
 * Overrides are honored only when they fit the account (assets cannot be
 * 'card'; liabilities cannot be 'cash' or 'reserve'). Closed accounts are
 * always 'ignore'.
 */
export function resolveAccountRoles(accounts = [], overrides = {}) {
  const roles = {};
  for (const a of accounts) {
    if (a.closed_at) {
      roles[a.id] = "ignore";
      continue;
    }
    const allowed = isAssetType(a.type) ? ASSET_ROLES : LIABILITY_ROLES;
    const override = overrides?.[a.id];
    const fallback = DEFAULT_ROLE_BY_TYPE[a.type] ?? "ignore";
    roles[a.id] = allowed.has(override) ? override : (allowed.has(fallback) ? fallback : "ignore");
  }
  return roles;
}

/**
 * The paying account for a card's statement, or null when the card has no
 * usable cycle: both days set and an open asset account (other than itself)
 * that is present in `accountsById`.
 */
export function settlementPayer(card, accountsById) {
  if (!card || card.closed_at || isAssetType(card.type)) return null;
  if (!card.statement_close_day || !card.payment_due_day) return null;
  const payer = card.payment_account_id ? accountsById[card.payment_account_id] : null;
  if (!payer || payer.id === card.id || payer.closed_at || !isAssetType(payer.type)) return null;
  return payer;
}

// ── Series helpers ──────────────────────────────────────────────────────────

/** Index of the first date >= dateStr, or dates.length when none. */
function firstIndexOnOrAfter(dates, dateStr) {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] < dateStr) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function makeState(dates, accountIds, series) {
  const balances = {};
  for (const id of accountIds) {
    balances[id] = series.map((pt) => Math.round(Number(pt.balances?.[id] ?? 0)));
  }
  return { dates, balances };
}

/** Add `delta` (raw sign) to an account from `dateStr` onward. */
function applyDelta(state, accountId, dateStr, delta) {
  const series = state.balances[accountId];
  if (!series || !delta) return;
  for (let i = firstIndexOnOrAfter(state.dates, dateStr); i < series.length; i += 1) {
    series[i] += delta;
  }
}

/**
 * Raw-sign balance effect of money leaving (`out`) or entering an account.
 * Leaving an asset lowers it; a charge on a liability raises what is owed.
 */
function flowDelta(account, amount, out) {
  const asset = isAssetType(account.type);
  return (asset ? 1 : -1) * (out ? -amount : amount);
}

/**
 * Normalize hypothetical items to individual account legs.
 * Item: { id, enabled?, type: 'expense'|'income'|'transfer', accountId,
 *         toAccountId?, amount (positive cents), date }
 * Leg:  { itemId, accountId, date, amount, out }
 */
export function itemLegs(items = [], accountsById = {}) {
  const legs = [];
  for (const item of items) {
    if (!item || item.enabled === false) continue;
    const amount = Math.abs(Math.round(Number(item.amount) || 0));
    if (!amount || !item.date || !accountsById[item.accountId]) continue;
    if (item.type === "expense") {
      legs.push({ itemId: item.id, accountId: item.accountId, date: item.date, amount, out: true });
    } else if (item.type === "income") {
      legs.push({ itemId: item.id, accountId: item.accountId, date: item.date, amount, out: false });
    } else if (item.type === "transfer") {
      if (!accountsById[item.toAccountId] || item.toAccountId === item.accountId) continue;
      legs.push({ itemId: item.id, accountId: item.accountId, date: item.date, amount, out: true, transfer: true });
      legs.push({ itemId: item.id, accountId: item.toAccountId, date: item.date, amount, out: false, transfer: true });
    }
  }
  return legs;
}

// ── Settlement ──────────────────────────────────────────────────────────────

/**
 * Payments into a card, split by kind. Card legs of transfers have
 * is_income = true (a payment reduces what is owed).
 *  - placeholders: projected rows (recurring payments with a stand-in amount)
 *  - recorded:     posted/pending rows (money that has or will really move)
 */
function cardPayments(cardId, transactions) {
  const placeholders = [];
  const recorded = [];
  for (const tx of transactions) {
    if (tx.account_id !== cardId || !tx.is_income || !tx.transfer_group_id) continue;
    if (tx.status === "projected") placeholders.push(tx);
    else recorded.push(tx);
  }
  return { placeholders, recorded };
}

function otherLegAccount(tx, byGroup) {
  const legs = byGroup.get(tx.transfer_group_id) || [];
  return legs.find((l) => l.id !== tx.id)?.account_id ?? null;
}

/**
 * Settle one card in date order, mutating `state`. Returns settlement records.
 */
function settleCard({ state, card, payer, accountsById, transactions, byGroup, hypotheticalPayments, todayStr }) {
  const { dates } = state;
  if (!dates.length || !state.balances[card.id]) return [];
  const cycles = statementCycles({
    closeDay: card.statement_close_day,
    dueDay: card.payment_due_day,
    from: dates[0],
    to: dates[dates.length - 1],
  });
  const { placeholders, recorded } = cardPayments(card.id, transactions);
  const settlements = [];

  for (const cycle of cycles) {
    const inWindow = (d) => d > cycle.closeDate && d <= cycle.nextCloseDate;
    const windowPlaceholders = placeholders
      .filter((tx) => inWindow(tx.transaction_date) && tx.transaction_date > todayStr)
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    const firstPlaceholderDate = windowPlaceholders[0]?.transaction_date;
    const paymentDate = firstPlaceholderDate ?? cycle.dueDate;

    // Payments already in the past are real history; leave them alone.
    if (paymentDate <= todayStr) continue;
    // The statement balance must be inside the series to be known.
    const closeIdx = dates.indexOf(cycle.closeDate);
    if (closeIdx === -1) continue;

    const statement = Math.max(0, state.balances[card.id][closeIdx]);
    const recordedTotal =
      recorded
        .filter((tx) => inWindow(tx.transaction_date))
        .reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0)
      + hypotheticalPayments
        .filter((leg) => leg.accountId === card.id && inWindow(leg.date))
        .reduce((sum, leg) => sum + leg.amount, 0);
    const amount = Math.max(0, statement - recordedTotal);

    // Reverse each placeholder on both legs; the computed payment replaces it.
    const replaced = [];
    for (const tx of windowPlaceholders) {
      const placeholderAmount = Math.abs(Number(tx.amount) || 0);
      const fromId = otherLegAccount(tx, byGroup) ?? payer.id;
      applyDelta(state, card.id, tx.transaction_date, placeholderAmount);
      if (accountsById[fromId]) {
        applyDelta(state, fromId, tx.transaction_date, -flowDelta(accountsById[fromId], placeholderAmount, true));
      }
      replaced.push({ id: tx.id, date: tx.transaction_date, amount: placeholderAmount, fromAccountId: fromId });
    }

    // Pay from the placeholder's source account when there is one, so a
    // payment the user scheduled from another account stays there.
    const payFromId = replaced[0]?.fromAccountId && accountsById[replaced[0].fromAccountId]
      ? replaced[0].fromAccountId
      : payer.id;
    if (amount > 0) {
      applyDelta(state, card.id, paymentDate, -amount);
      applyDelta(state, payFromId, paymentDate, flowDelta(accountsById[payFromId], amount, true));
    }

    if (amount > 0 || replaced.length) {
      settlements.push({
        cardId: card.id,
        payerId: payFromId,
        closeDate: cycle.closeDate,
        dueDate: cycle.dueDate,
        paymentDate,
        statement,
        alreadyPaid: recordedTotal,
        amount,
        replaced,
      });
    }
  }
  return settlements;
}

// ── Scenario ────────────────────────────────────────────────────────────────

function runScenario({ dates, series, accounts, accountsById, roles, transactions, byGroup, items, todayStr }) {
  const accountIds = accounts.map((a) => a.id).filter((id) => series.some((pt) => id in (pt.balances || {})));
  const state = makeState(dates, accountIds, series);

  // Hypothetical items first: they change statement balances.
  const legs = itemLegs(items, accountsById).filter((leg) => state.balances[leg.accountId]);
  for (const leg of legs) {
    applyDelta(state, leg.accountId, leg.date, flowDelta(accountsById[leg.accountId], leg.amount, leg.out));
  }
  const hypotheticalPayments = legs.filter((leg) => leg.transfer && !leg.out);

  const settlements = [];
  for (const id of accountIds) {
    if (roles[id] !== "card") continue;
    const card = accountsById[id];
    const payer = settlementPayer(card, accountsById);
    if (!payer || !state.balances[payer.id]) continue;
    settlements.push(
      ...settleCard({ state, card, payer, accountsById, transactions, byGroup, hypotheticalPayments, todayStr }),
    );
  }
  settlements.sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.cardId.localeCompare(b.cardId));

  const sumRole = (role) => dates.map((_, i) =>
    accountIds.reduce((sum, id) => (roles[id] === role ? sum + state.balances[id][i] : sum), 0));

  return {
    balances: state.balances,
    cash: sumRole("cash"),
    reserve: sumRole("reserve"),
    cardDebt: sumRole("card"),
    settlements,
  };
}

/** Lowest value on or after `fromDate`: { amount, date } or null. */
export function lowestPoint(values, dates, fromDate) {
  let best = null;
  for (let i = firstIndexOnOrAfter(dates, fromDate); i < dates.length; i += 1) {
    if (best === null || values[i] < best.amount) best = { amount: values[i], date: dates[i] };
  }
  return best;
}

/**
 * How much could leave cash on `fromDate` without the cash total dropping
 * below `cushion` on that day or any later day in the window.
 */
export function headroomFrom(values, dates, fromDate, cushion = 0) {
  const low = lowestPoint(values, dates, fromDate);
  return low ? low.amount - cushion : null;
}

/**
 * Build baseline (no hypothetical items) and scenario projections.
 *
 * @param {Object} opts
 * @param {Array}  opts.accounts      rows from get_account_balances
 * @param {Array}  opts.series        [{ date, balances: { [accountId]: cents } }], daily, ascending
 * @param {Array}  [opts.transactions] upcoming pending/projected rows plus recent
 *                                    posted card payments (both transfer legs)
 * @param {Array}  [opts.items]       hypothetical items (amount in cents)
 * @param {Object} [opts.roleOverrides] { [accountId]: role }
 * @param {number} [opts.cushion]     minimum cash to keep, cents
 * @param {string} opts.todayStr      YYYY-MM-DD local today
 */
export function buildCashflowScenario({
  accounts = [],
  series = [],
  transactions = [],
  items = [],
  roleOverrides = {},
  cushion = 0,
  todayStr,
}) {
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const roles = resolveAccountRoles(accounts, roleOverrides);
  const dates = series.map((pt) => pt.date);

  // Dedupe transactions by id (callers may merge overlapping queries).
  const txById = new Map();
  for (const tx of transactions) if (tx?.id && !tx.deleted_at) txById.set(tx.id, tx);
  const txList = [...txById.values()];
  const byGroup = new Map();
  for (const tx of txList) {
    if (!tx.transfer_group_id) continue;
    if (!byGroup.has(tx.transfer_group_id)) byGroup.set(tx.transfer_group_id, []);
    byGroup.get(tx.transfer_group_id).push(tx);
  }

  const common = { dates, series, accounts, accountsById, roles, transactions: txList, byGroup, todayStr };
  const baseline = runScenario({ ...common, items: [] });
  const scenario = runScenario({ ...common, items });

  const fromDate = todayStr;
  const lowest = lowestPoint(scenario.cash, dates, fromDate);
  const baselineLowest = lowestPoint(baseline.cash, dates, fromDate);
  const last = dates.length - 1;

  return {
    dates,
    roles,
    baseline,
    scenario,
    summary: {
      cushion,
      lowest,
      baselineLowest,
      impact: lowest && baselineLowest ? lowest.amount - baselineLowest.amount : 0,
      headroom: lowest ? lowest.amount - cushion : null,
      belowCushion: lowest ? lowest.amount < cushion : false,
      endCash: last >= 0 ? scenario.cash[last] : null,
      endCardDebt: last >= 0 ? scenario.cardDebt[last] : null,
    },
  };
}
