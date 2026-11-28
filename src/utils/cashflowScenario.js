// Pure cashflow-scenario engine for the Accounts → Cashflow tab.
//
// Takes the daily per-account balance series (from get_account_balance_history,
// which already includes pending and projected transactions), layers on
// hypothetical "what if" items, and settles credit cards that have a statement
// cycle configured: each statement's balance is paid in full from the paying
// account, replacing any unlocked projected payment. The per-card statement
// math (computeStatementPayments) is also used to generate the real recurring
// statement-payment transactions.
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
  if (series) applySeriesDelta(state.dates, series, dateStr, delta);
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

/** A projected payment the forecast may replace: not hand-edited by the user. */
export const isProjectedPlaceholder = (tx) => tx.status === "projected" && !tx.amount_locked;

/**
 * Payments into a card, split by kind. Card legs of transfers have
 * is_income = true (a payment reduces what is owed).
 *  - placeholders: rows whose amount the calculation replaces (`isReplaceable`)
 *  - recorded:     everything else (money that has or will really move)
 */
function cardPayments(cardId, transactions, isReplaceable) {
  const placeholders = [];
  const recorded = [];
  for (const tx of transactions) {
    if (tx.account_id !== cardId || !tx.is_income || !tx.transfer_group_id) continue;
    if (isReplaceable(tx)) placeholders.push(tx);
    else recorded.push(tx);
  }
  return { placeholders, recorded };
}

function otherLegAccount(tx, byGroup) {
  const legs = byGroup.get(tx.transfer_group_id) || [];
  return legs.find((l) => l.id !== tx.id)?.account_id ?? null;
}

/** Add `delta` to a single daily series from `dateStr` onward (in place). */
function applySeriesDelta(dates, series, dateStr, delta) {
  if (!delta) return;
  for (let i = firstIndexOnOrAfter(dates, dateStr); i < series.length; i += 1) {
    series[i] += delta;
  }
}

/**
 * Pay-in-full statement payments for one card, in date order.
 *
 * Shared by the cashflow forecast and recurring statement-payment generation,
 * so both always agree. Card side only: the paying account is the caller's job.
 *
 * @param {Object}   opts
 * @param {Object}   opts.card          account row with statement_close_day / payment_due_day
 * @param {string[]} opts.dates         ascending daily YYYY-MM-DD dates
 * @param {number[]} opts.balances      card raw-sign balance per date (owed = positive);
 *                                      includes posted, pending, and projected rows
 * @param {Array}    [opts.transactions] payment legs (both legs of transfers are fine)
 * @param {Function} [opts.isReplaceable] which card payments the computed payment
 *                                      replaces; default: unlocked projected rows
 * @param {Array}    [opts.extraPayments] [{ date, amount }] extra payments into the card
 * @param {string}   opts.todayStr      YYYY-MM-DD local today
 * @returns {{ balances: number[], statements: Array<{
 *   closeDate: string, dueDate: string, paymentDate: string, closed: boolean,
 *   statement: number, alreadyPaid: number, amount: number, replaced: Array }> }}
 *   `balances` is a new series with replaced rows reversed and computed payments
 *   applied. A statement is listed when it needs a payment or replaces a row.
 */
export function computeStatementPayments({
  card,
  dates = [],
  balances = [],
  transactions = [],
  isReplaceable = isProjectedPlaceholder,
  extraPayments = [],
  todayStr,
}) {
  const series = balances.map((v) => Math.round(Number(v) || 0));
  if (!dates.length || !card?.statement_close_day || !card?.payment_due_day) {
    return { balances: series, statements: [] };
  }
  const cycles = statementCycles({
    closeDay: card.statement_close_day,
    dueDay: card.payment_due_day,
    from: dates[0],
    to: dates[dates.length - 1],
  });
  const { placeholders, recorded } = cardPayments(card.id, transactions, isReplaceable);
  const statements = [];

  for (const cycle of cycles) {
    const inWindow = (d) => d > cycle.closeDate && d <= cycle.nextCloseDate;
    const replaced = placeholders
      .filter((tx) => inWindow(tx.transaction_date) && tx.transaction_date > todayStr)
      .sort((a, b) => a.transaction_date.localeCompare(b.transaction_date));
    const paymentDate = replaced[0]?.transaction_date ?? cycle.dueDate;

    // Payments already in the past are real history; leave them alone.
    if (paymentDate <= todayStr) continue;
    // The statement balance must be inside the series to be known.
    const closeIdx = dates.indexOf(cycle.closeDate);
    if (closeIdx === -1) continue;

    const statement = Math.max(0, series[closeIdx]);
    const alreadyPaid =
      recorded
        .filter((tx) => inWindow(tx.transaction_date))
        .reduce((sum, tx) => sum + Math.abs(Number(tx.amount) || 0), 0)
      + extraPayments
        .filter((p) => inWindow(p.date))
        .reduce((sum, p) => sum + Math.abs(Number(p.amount) || 0), 0);
    // A hand-edited payment is the user's answer for this statement (the real
    // statement often differs from the estimate: charges near the close date
    // land on either side, pending charges post late). Nothing more is paid
    // for this cycle; whatever is still owed stays on the card and rolls into
    // the next statement. A generated payment answers the statement it was
    // generated for, even when the user moved its date past the next close.
    const settled = recorded.some((tx) =>
      tx.amount_locked && inWindow(tx.recurring_occurrence_date ?? tx.transaction_date));
    const amount = settled ? 0 : Math.max(0, statement - alreadyPaid);

    // Reverse each replaced row; the computed payment takes its place.
    for (const tx of replaced) {
      applySeriesDelta(dates, series, tx.transaction_date, Math.abs(Number(tx.amount) || 0));
    }
    if (amount > 0) applySeriesDelta(dates, series, paymentDate, -amount);

    if (amount > 0 || replaced.length) {
      statements.push({
        closeDate: cycle.closeDate,
        dueDate: cycle.dueDate,
        paymentDate,
        closed: cycle.closeDate < todayStr,
        statement,
        alreadyPaid,
        amount,
        replaced,
      });
    }
  }
  return { balances: series, statements };
}

/**
 * Settle one card in date order, mutating `state`. Returns settlement records.
 */
function settleCard({ state, card, payer, accountsById, transactions, byGroup, hypotheticalPayments, todayStr }) {
  if (!state.dates.length || !state.balances[card.id]) return [];
  const { balances, statements } = computeStatementPayments({
    card,
    dates: state.dates,
    balances: state.balances[card.id],
    transactions,
    extraPayments: hypotheticalPayments.filter((leg) => leg.accountId === card.id),
    todayStr,
  });
  state.balances[card.id] = balances;

  return statements.map((s) => {
    // Reverse each replaced row's other leg too.
    const replaced = s.replaced.map((tx) => {
      const amount = Math.abs(Number(tx.amount) || 0);
      const fromId = otherLegAccount(tx, byGroup) ?? payer.id;
      if (accountsById[fromId]) {
        applyDelta(state, fromId, tx.transaction_date, -flowDelta(accountsById[fromId], amount, true));
      }
      return { id: tx.id, date: tx.transaction_date, amount, fromAccountId: fromId };
    });

    // Pay from the placeholder's source account when there is one, so a
    // payment the user scheduled from another account stays there.
    const payFromId = replaced[0]?.fromAccountId && accountsById[replaced[0].fromAccountId]
      ? replaced[0].fromAccountId
      : payer.id;
    if (s.amount > 0) {
      applyDelta(state, payFromId, s.paymentDate, flowDelta(accountsById[payFromId], s.amount, true));
    }

    return {
      cardId: card.id,
      payerId: payFromId,
      closeDate: s.closeDate,
      dueDate: s.dueDate,
      paymentDate: s.paymentDate,
      statement: s.statement,
      alreadyPaid: s.alreadyPaid,
      amount: s.amount,
      replaced,
    };
  });
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

/**
 * When a hypothetical card charge gets paid, for the item list.
 * Returns null for items that are not charges on a card, otherwise
 *  { status: 'settles', closeDate, paymentDate, payerId }  — paid within the range
 *  { status: 'after-range', closeDate, dueDate, payerId }  — statement known, payment past the range
 *  { status: 'not-set-up' }                                 — card has no usable cycle
 */
export function itemSettlementInfo(item, accountsById = {}, settlements = []) {
  const account = accountsById[item?.accountId];
  if (!item?.date || !account || isAssetType(account.type) || item.type !== "expense") return null;
  const payer = settlementPayer(account, accountsById);
  if (!payer) return { status: "not-set-up" };
  const { y, m } = parts(item.date);
  const [cycle] = statementCycles({
    closeDay: account.statement_close_day,
    dueDay: account.payment_due_day,
    from: item.date,
    to: clampedDate(y, m + 1, 31),
  });
  if (!cycle) return { status: "not-set-up" };
  const match = settlements.find((s) => s.cardId === account.id && s.closeDate === cycle.closeDate);
  if (match && match.amount > 0) {
    return { status: "settles", closeDate: cycle.closeDate, paymentDate: match.paymentDate, payerId: match.payerId };
  }
  return { status: "after-range", closeDate: cycle.closeDate, dueDate: cycle.dueDate, payerId: payer.id };
}
