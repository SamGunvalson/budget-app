import assert from "node:assert/strict";
import { test } from "node:test";
import { computeStatementPayments } from "../src/utils/cashflowScenario.js";
import {
  amountLockedAfterEdit,
  canPayStatementBalance,
  planStatementPaymentWrites,
  replaceableFor,
  statementPaymentStatus,
  withStatementSchedule,
} from "../src/utils/statementPayments.js";

const TODAY = "2026-11-17";
const WINDOW_END = "2027-02-15";
// Closes the 10th, due the 5th of the next month.
const card = { id: "visa", type: "credit_card", statement_close_day: 10, payment_due_day: 5 };
const template = { id: "tpl", pays_statement_balance: true, frequency: "weekly", day_of_week: 2, to_account: card };

function cardSeries(start, end, events = []) {
  const dates = [];
  const balances = [];
  const d = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  while (d <= stop) {
    const date = d.toISOString().slice(0, 10);
    dates.push(date);
    balances.push(events.filter((e) => e.date <= date).reduce((sum, e) => sum + e.delta, 0));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return { dates, balances };
}

// A generated payment row of the template (both legs).
function generated(group, date, amount, extra = {}) {
  const shared = {
    transfer_group_id: group, recurring_template_id: "tpl", recurring_occurrence_date: date,
    transaction_date: date, amount, status: "projected", ...extra,
  };
  return [
    { ...shared, id: `${group}-card`, account_id: "visa", is_income: true },
    { ...shared, id: `${group}-from`, account_id: "chk", is_income: false },
  ];
}

function plan(events, rows = []) {
  const { dates, balances } = cardSeries("2026-09-01", WINDOW_END, events);
  const { statements } = computeStatementPayments({
    card, dates, balances, transactions: rows, isReplaceable: replaceableFor("tpl"), todayStr: TODAY,
  });
  return planStatementPaymentWrites({ statements, templateRows: rows, todayStr: TODAY, windowEndStr: WINDOW_END });
}

test("only open credit cards with both statement days can be paid by statement", () => {
  assert.equal(canPayStatementBalance(card), true);
  assert.equal(canPayStatementBalance({ ...card, payment_due_day: null }), false);
  assert.equal(canPayStatementBalance({ ...card, closed_at: "2026-01-01" }), false);
  assert.equal(canPayStatementBalance({ ...card, type: "checking" }), false);
  assert.equal(canPayStatementBalance(null), false);
});

test("a statement template follows the card's due day; others are untouched", () => {
  const t = withStatementSchedule(template);
  assert.equal(t.frequency, "monthly");
  assert.equal(t.day_of_month, 5);
  assert.equal(t.day_of_week, null);
  const plain = { id: "x", frequency: "weekly", to_account: card };
  assert.equal(withStatementSchedule(plain), plain);
  const unset = { ...template, to_account: { ...card, payment_due_day: null } };
  assert.equal(withStatementSchedule(unset), unset);
});

test("closed statements are pending; estimates are projected until within a week", () => {
  assert.equal(statementPaymentStatus({ closed: true, paymentDate: "2027-01-05", todayStr: TODAY }), "pending");
  assert.equal(statementPaymentStatus({ closed: false, paymentDate: "2026-11-24", todayStr: TODAY }), "pending");
  assert.equal(statementPaymentStatus({ closed: false, paymentDate: "2026-11-25", todayStr: TODAY }), "projected");
});

test("a card that is never used gets no payments", () => {
  assert.deepEqual(plan([]), { creates: [], updates: [], deletes: [] });
});

test("a closed statement with a balance creates a pending payment; the open cycle an estimate", () => {
  const writes = plan([
    { date: "2026-11-03", delta: 80000 }, // closed Nov 10 statement
    { date: "2026-11-14", delta: 2500 }, // open cycle
  ]);
  assert.deepEqual(writes.creates, [
    { date: "2026-12-05", amount: 80000, status: "pending" },
    { date: "2027-01-05", amount: 2500, status: "projected" },
  ]);
  assert.deepEqual(writes.updates, []);
});

test("a dummy-amount row is corrected on both legs", () => {
  const rows = generated("g1", "2026-12-05", 100);
  // The series already includes the $1 row.
  const writes = plan([{ date: "2026-11-03", delta: 80000 }, { date: "2026-12-05", delta: -100 }], rows);
  assert.deepEqual(writes.updates, [{ ids: ["g1-card", "g1-from"], amount: 80000, status: "pending" }]);
  assert.deepEqual(writes.creates, []);
});

test("an up-to-date row is left alone", () => {
  const rows = generated("g1", "2026-12-05", 80000, { status: "pending" });
  const writes = plan([{ date: "2026-11-03", delta: 80000 }, { date: "2026-12-05", delta: -80000 }], rows);
  assert.deepEqual(writes, { creates: [], updates: [], deletes: [] });
});

test("a row for a statement that is now zero is removed", () => {
  const rows = generated("g1", "2026-12-05", 3000);
  const writes = plan([
    { date: "2026-11-03", delta: 3000 },
    { date: "2026-11-04", delta: -3000 }, // refunded
    { date: "2026-12-05", delta: -3000 },
  ], rows);
  assert.deepEqual(writes.deletes, ["g1-card", "g1-from"]);
  assert.deepEqual(writes.creates, []);
});

test("a hand-edited row is kept and not duplicated", () => {
  const rows = generated("g1", "2026-12-05", 50000, { status: "pending", amount_locked: true });
  const writes = plan([{ date: "2026-11-03", delta: 80000 }, { date: "2026-12-05", delta: -50000 }], rows);
  assert.deepEqual(writes, { creates: [], updates: [], deletes: [] });
});

test("payments due after the projection window are not created yet", () => {
  const writes = plan([{ date: "2027-02-01", delta: 4000 }]);
  // Closes Feb 10, due Mar 5 — past the window end.
  assert.deepEqual(writes.creates, []);
});

test("only an amount change on a generated row locks it, and a lock is kept", () => {
  const leg = { recurring_template_id: "tpl", amount: 5000 };
  assert.equal(amountLockedAfterEdit([{ leg, amount: 5000 }, { leg, amount: -5000 }]), false);
  assert.equal(amountLockedAfterEdit([{ leg, amount: 5000 }, { leg, amount: 6000 }]), true);
  assert.equal(amountLockedAfterEdit([{ leg: { amount: 5000 }, amount: 6000 }]), false);
  assert.equal(amountLockedAfterEdit([{ leg: { ...leg, amount_locked: true }, amount: 5000 }]), true);
  assert.equal(amountLockedAfterEdit([{ leg, amount: undefined }]), false);
});

test("a row left on an old due date is replaced on the card's current due date", () => {
  // Generated for the 3rd before the card's due day moved to the 5th.
  const rows = generated("g1", "2026-12-03", 80000, { status: "pending" });
  const writes = plan([{ date: "2026-11-03", delta: 80000 }, { date: "2026-12-03", delta: -80000 }], rows);
  assert.deepEqual(writes.deletes, ["g1-card", "g1-from"]);
  assert.deepEqual(writes.creates, [{ date: "2026-12-05", amount: 80000, status: "pending" }]);
  assert.deepEqual(writes.updates, []);
});
