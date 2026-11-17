import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCashflowScenario,
  clampedDate,
  headroomFrom,
  itemLegs,
  resolveAccountRoles,
  settlementPayer,
  statementCycles,
} from "../src/utils/cashflowScenario.js";

const TODAY = "2026-11-17";

const checking = { id: "chk", type: "checking" };
const savings = { id: "sav", type: "savings" };
const cardA = {
  id: "visa", type: "credit_card",
  statement_close_day: 22, payment_due_day: 17, payment_account_id: "chk",
};
const cardB = {
  id: "amex", type: "credit_card",
  statement_close_day: 5, payment_due_day: 28, payment_account_id: "chk",
};

function dateRange(start, end) {
  const out = [];
  const d = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  while (d <= stop) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * Daily raw-sign series, like get_account_balance_history.
 * `events`: [{ date, id, delta }] applied from `date` onward.
 */
function makeSeries(start, end, opening, events = []) {
  return dateRange(start, end).map((date) => {
    const balances = { ...opening };
    for (const e of events) if (e.date <= date) balances[e.id] = (balances[e.id] ?? 0) + e.delta;
    return { date, balances };
  });
}

const at = (result, kind, id, date) => result[kind].balances[id][result.dates.indexOf(date)];

// A projected recurring card payment with a stand-in amount (both legs).
function placeholder(group, date, amount, { card = "visa", from = "chk", status = "projected" } = {}) {
  return [
    { id: `${group}-card`, account_id: card, is_income: true, transfer_group_id: group, status, amount, transaction_date: date },
    { id: `${group}-from`, account_id: from, is_income: false, transfer_group_id: group, status, amount, transaction_date: date },
  ];
}

test("dates clamp to the month end and roll over years", () => {
  assert.equal(clampedDate(2026, 2, 31), "2026-02-28");
  assert.equal(clampedDate(2028, 2, 30), "2028-02-29");
  assert.equal(clampedDate(2026, 13, 5), "2027-01-05");
});

test("statement cycles put the due date in the right month", () => {
  assert.deepEqual(
    statementCycles({ closeDay: 22, dueDay: 17, from: "2026-11-01", to: "2027-01-31" }),
    [
      { closeDate: "2026-11-22", dueDate: "2026-12-17", nextCloseDate: "2026-12-22" },
      { closeDate: "2026-12-22", dueDate: "2027-01-17", nextCloseDate: "2027-01-22" },
      { closeDate: "2027-01-22", dueDate: "2027-02-17", nextCloseDate: "2027-02-22" },
    ],
  );
  const sameMonth = statementCycles({ closeDay: 5, dueDay: 28, from: "2026-11-10", to: "2026-12-31" });
  assert.deepEqual(sameMonth, [{ closeDate: "2026-12-05", dueDate: "2026-12-28", nextCloseDate: "2027-01-05" }]);
  const feb = statementCycles({ closeDay: 31, dueDay: 25, from: "2027-02-01", to: "2027-02-28" });
  assert.deepEqual(feb, [{ closeDate: "2027-02-28", dueDate: "2027-03-25", nextCloseDate: "2027-03-31" }]);
  assert.deepEqual(statementCycles({ closeDay: null, dueDay: 5, from: "2026-11-01", to: "2026-12-01" }), []);
});

test("roles default by type, reject overrides that do not fit, and ignore closed accounts", () => {
  const roles = resolveAccountRoles(
    [checking, savings, cardA, { id: "old", type: "checking", closed_at: "2026-01-01" }, { id: "home", type: "mortgage" }],
    { sav: "cash", visa: "cash", home: "card" },
  );
  assert.deepEqual(roles, { chk: "cash", sav: "cash", visa: "card", old: "ignore", home: "card" });
});

test("a card needs both days and an open asset payer to settle", () => {
  const byId = { chk: checking, sav: savings, visa: cardA };
  assert.equal(settlementPayer(cardA, byId), checking);
  assert.equal(settlementPayer({ ...cardA, payment_due_day: null }, byId), null);
  assert.equal(settlementPayer({ ...cardA, payment_account_id: "gone" }, byId), null);
  assert.equal(settlementPayer(cardA, { ...byId, chk: { ...checking, closed_at: "2026-10-01" } }), null);
});

test("disabled, empty, and self transfers produce no legs", () => {
  const byId = { chk: checking, visa: cardA };
  assert.deepEqual(itemLegs([
    { id: 1, type: "expense", accountId: "visa", amount: 100, date: TODAY, enabled: false },
    { id: 2, type: "expense", accountId: "visa", amount: 0, date: TODAY },
    { id: 3, type: "transfer", accountId: "chk", toAccountId: "chk", amount: 100, date: TODAY },
    { id: 4, type: "expense", accountId: "missing", amount: 100, date: TODAY },
  ], byId), []);
});

test("a card purchase before the close date is paid from checking on the due date", () => {
  const series = makeSeries("2026-11-01", "2027-01-31", { chk: 500000, visa: 0 });
  const result = buildCashflowScenario({
    accounts: [checking, cardA],
    series,
    items: [{ id: 1, type: "expense", accountId: "visa", amount: 150000, date: "2026-11-20" }],
    todayStr: TODAY,
    cushion: 100000,
  });

  assert.deepEqual(result.baseline.settlements, []);
  const [bike] = result.scenario.settlements;
  assert.equal(bike.closeDate, "2026-11-22");
  assert.equal(bike.paymentDate, "2026-12-17");
  assert.equal(bike.amount, 150000);
  assert.equal(at(result, "scenario", "visa", "2026-12-16"), 150000);
  assert.equal(at(result, "scenario", "visa", "2026-12-17"), 0);
  assert.equal(at(result, "scenario", "chk", "2026-12-16"), 500000);
  assert.equal(at(result, "scenario", "chk", "2026-12-17"), 350000);

  assert.deepEqual(result.summary.lowest, { amount: 350000, date: "2026-12-17" });
  assert.deepEqual(result.summary.baselineLowest, { amount: 500000, date: TODAY });
  assert.equal(result.summary.impact, -150000);
  assert.equal(result.summary.headroom, 250000);
  assert.equal(result.summary.belowCushion, false);
  assert.equal(result.summary.endCardDebt, 0);
});

test("a purchase after the close date waits for the next statement", () => {
  const series = makeSeries("2026-11-01", "2027-01-31", { chk: 500000, visa: 0 });
  const result = buildCashflowScenario({
    accounts: [checking, cardA],
    series,
    items: [{ id: 1, type: "expense", accountId: "visa", amount: 150000, date: "2026-11-23" }],
    todayStr: TODAY,
  });
  assert.deepEqual(result.scenario.settlements.map((s) => [s.closeDate, s.paymentDate, s.amount]), [
    ["2026-12-22", "2027-01-17", 150000],
  ]);
  assert.equal(at(result, "scenario", "chk", "2026-12-31"), 500000);
  assert.equal(at(result, "scenario", "chk", "2027-01-17"), 350000);
});

test("a placeholder recurring payment is replaced by the statement balance", () => {
  const tx = placeholder("g1", "2026-12-15", 5000);
  // The series already includes the placeholder's $50 on both legs.
  const series = makeSeries("2026-11-01", "2026-12-31", { chk: 500000, visa: 0 }, [
    { date: "2026-11-10", id: "visa", delta: 80000 },
    { date: "2026-12-15", id: "visa", delta: -5000 },
    { date: "2026-12-15", id: "chk", delta: -5000 },
  ]);
  const result = buildCashflowScenario({ accounts: [checking, cardA], series, transactions: tx, todayStr: TODAY });

  for (const kind of ["baseline", "scenario"]) {
    const [s] = result[kind].settlements;
    assert.equal(s.paymentDate, "2026-12-15", "keeps the scheduled date");
    assert.equal(s.amount, 80000);
    assert.deepEqual(s.replaced, [{ id: "g1-card", date: "2026-12-15", amount: 5000, fromAccountId: "chk" }]);
    assert.equal(at(result, kind, "chk", "2026-12-15"), 420000);
    assert.equal(at(result, kind, "visa", "2026-12-15"), 0);
  }
});

test("a statement already paid since it closed is not paid again", () => {
  const series = makeSeries("2026-11-01", "2026-12-31", { chk: 500000, visa: 0 }, [
    { date: "2026-11-03", id: "visa", delta: 80000 },
    { date: "2026-11-15", id: "visa", delta: -80000 },
    { date: "2026-11-15", id: "chk", delta: -80000 },
    // Next month's $50 placeholder, already in the series.
    { date: "2026-12-04", id: "visa", delta: -5000 },
    { date: "2026-12-04", id: "chk", delta: -5000 },
  ]);
  const card = { ...cardA, statement_close_day: 10, payment_due_day: 5 };
  const result = buildCashflowScenario({
    accounts: [checking, card],
    series,
    transactions: [
      ...placeholder("paid", "2026-11-15", 80000, { status: "posted" }),
      ...placeholder("next", "2026-12-04", 5000),
    ],
    todayStr: TODAY,
  });
  const nov = result.baseline.settlements.find((s) => s.closeDate === "2026-11-10");
  assert.equal(nov.alreadyPaid, 80000);
  assert.equal(nov.amount, 0);
  // The placeholder in that window is removed rather than paid.
  assert.deepEqual(nov.replaced.map((r) => r.id), ["next-card"]);
  assert.equal(at(result, "baseline", "chk", "2026-12-31"), 420000);
});

test("cards with different cycles settle on their own dates", () => {
  const series = makeSeries("2026-11-01", "2027-01-31", { chk: 500000, visa: 0, amex: 0 });
  const result = buildCashflowScenario({
    accounts: [checking, cardA, cardB],
    series,
    items: [
      { id: 1, type: "expense", accountId: "visa", amount: 90000, date: "2026-11-20" },
      { id: 2, type: "expense", accountId: "amex", amount: 60000, date: "2026-11-20" },
    ],
    todayStr: TODAY,
  });
  assert.deepEqual(result.scenario.settlements.map((s) => [s.cardId, s.paymentDate, s.amount]), [
    ["visa", "2026-12-17", 90000],
    ["amex", "2026-12-28", 60000],
  ]);
  assert.equal(at(result, "scenario", "chk", "2026-12-17"), 410000);
  assert.equal(at(result, "scenario", "chk", "2026-12-28"), 350000);
});

test("a hypothetical payment to the card counts toward the statement", () => {
  const series = makeSeries("2026-11-01", "2026-12-31", { chk: 500000, visa: 0 });
  const result = buildCashflowScenario({
    accounts: [checking, cardA],
    series,
    items: [
      { id: 1, type: "expense", accountId: "visa", amount: 100000, date: "2026-11-20" },
      { id: 2, type: "transfer", accountId: "chk", toAccountId: "visa", amount: 40000, date: "2026-12-01" },
    ],
    todayStr: TODAY,
  });
  const [s] = result.scenario.settlements;
  assert.equal(s.alreadyPaid, 40000);
  assert.equal(s.amount, 60000);
  assert.equal(at(result, "scenario", "chk", "2026-12-31"), 400000);
  assert.equal(at(result, "scenario", "visa", "2026-12-31"), 0);
});

test("cards without a payer stay unsettled and count as card debt", () => {
  const series = makeSeries("2026-11-01", "2026-12-31", { chk: 500000, visa: 0, sav: 1000000 });
  const result = buildCashflowScenario({
    accounts: [checking, savings, { ...cardA, payment_account_id: null }],
    series,
    items: [{ id: 1, type: "expense", accountId: "visa", amount: 30000, date: "2026-11-20" }],
    todayStr: TODAY,
    cushion: 600000,
  });
  assert.deepEqual(result.scenario.settlements, []);
  assert.equal(result.summary.endCardDebt, 30000);
  assert.equal(result.summary.endCash, 500000);
  assert.equal(result.scenario.reserve.at(-1), 1000000);
  assert.equal(result.summary.belowCushion, true);
  assert.equal(result.summary.headroom, -100000);
});

test("headroom looks only at the chosen date and later", () => {
  const dates = ["2026-11-17", "2026-11-18", "2026-11-19"];
  assert.equal(headroomFrom([100, 50, 300], dates, "2026-11-17", 20), 30);
  assert.equal(headroomFrom([100, 50, 300], dates, "2026-11-19", 20), 280);
  assert.equal(headroomFrom([100], ["2026-11-17"], "2027-01-01", 0), null);
});
