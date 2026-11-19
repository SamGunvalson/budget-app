// Pure helpers for statement-driven credit card payments.
//
// A recurring transfer template with `pays_statement_balance` pays its
// destination card's statement in full. Its own amount and schedule are
// ignored: occurrences fall on the card's due dates and each amount comes from
// computeStatementPayments (shared with the cashflow forecast). This module
// decides which transaction writes bring the generated rows in line; the
// recurring service performs them. No imports beyond date math, so it is cheap
// to unit test.

/** True for a template whose amount comes from its card's statement. */
export function isStatementPaymentTemplate(template) {
  return !!template?.pays_statement_balance;
}

/**
 * Whether an account can be paid by statement balance: an open credit card
 * with both statement close day and payment due day set.
 */
export function canPayStatementBalance(account) {
  return !!account
    && account.type === "credit_card"
    && !account.closed_at
    && account.is_active !== false
    && !!account.statement_close_day
    && !!account.payment_due_day;
}

/**
 * The template with its schedule taken from the card: monthly on the due day.
 * Other templates (and statement templates whose card is not set up) are
 * returned unchanged.
 */
export function withStatementSchedule(template, card = template?.to_account) {
  if (!isStatementPaymentTemplate(template) || !card?.payment_due_day) return template;
  return {
    ...template,
    frequency: "monthly",
    day_of_month: card.payment_due_day,
    day_of_month_2: null,
    day_of_week: null,
    custom_interval: null,
    custom_unit: null,
  };
}

function addDaysStr(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Status for a generated payment: a closed statement's amount is known, so it
 * is pending; an estimate is projected until it is within a week (matching
 * recurring projections).
 */
export function statementPaymentStatus({ closed, paymentDate, todayStr }) {
  if (closed) return "pending";
  return paymentDate > addDaysStr(todayStr, 7) ? "projected" : "pending";
}

/**
 * Which rows computeStatementPayments may rewrite for this template: its own
 * unposted rows that the user has not hand-edited.
 */
export function replaceableFor(templateId) {
  return (tx) => tx.recurring_template_id === templateId
    && tx.status !== "posted"
    && !tx.amount_locked;
}

/**
 * Plan the writes that bring a template's generated rows in line with its
 * card's statements.
 *
 * @param {Object} opts
 * @param {Array}  opts.statements   from computeStatementPayments (with replaceableFor)
 * @param {Array}  opts.templateRows every live row of this template (both legs)
 * @param {string} opts.todayStr
 * @param {string} opts.windowEndStr last date generation projects to
 * @returns {{
 *   creates: Array<{ date: string, amount: number, status: string }>,
 *   updates: Array<{ ids: string[], amount: number, status: string }>,
 *   deletes: string[],
 * }} `ids`/`deletes` list every leg of the affected transfers.
 */
export function planStatementPaymentWrites({ statements = [], templateRows = [], todayStr, windowEndStr }) {
  const legsByGroup = new Map();
  const occupied = new Set();
  for (const row of templateRows) {
    const key = row.transfer_group_id ?? row.id;
    if (!legsByGroup.has(key)) legsByGroup.set(key, []);
    legsByGroup.get(key).push(row);
    occupied.add(row.recurring_occurrence_date ?? row.transaction_date);
  }
  const legsOf = (tx) => legsByGroup.get(tx.transfer_group_id ?? tx.id) ?? [tx];

  const creates = [];
  const updates = [];
  const deletes = [];

  for (const s of statements) {
    // A row generated for a different due date (the card's due day changed)
    // is replaced by one on the current due date.
    const current = s.replaced.filter((tx) => (tx.recurring_occurrence_date ?? tx.transaction_date) === s.dueDate);
    const stale = s.replaced.filter((tx) => !current.includes(tx));
    const [keep, ...extra] = s.amount > 0 ? current : [];
    const drop = [...stale, ...(s.amount > 0 ? extra : current)];
    for (const tx of drop) deletes.push(...legsOf(tx).map((l) => l.id));
    if (!(s.amount > 0)) continue;

    const paymentDate = keep?.transaction_date ?? s.dueDate;
    const status = statementPaymentStatus({ closed: s.closed, paymentDate, todayStr });
    if (keep) {
      const legs = legsOf(keep);
      const stale = legs.some((l) => Math.abs(Number(l.amount)) !== s.amount || l.status !== status);
      if (stale) updates.push({ ids: legs.map((l) => l.id), amount: s.amount, status });
    } else if (s.dueDate <= windowEndStr && !occupied.has(s.dueDate) && s.dueDate > todayStr) {
      // A posted or hand-edited row already holds this occurrence: the
      // remainder stays unscheduled rather than duplicating it.
      creates.push({ date: s.dueDate, amount: s.amount, status });
    }
  }
  return { creates, updates, deletes };
}

/**
 * Whether a transfer edit should lock its amount against recalculation: the
 * transfer is generated from a recurring template and the user changed either
 * leg's amount (or it was already locked). Both legs share the result.
 *
 * @param {Array<{ leg: Object, amount?: number }>} edits each leg with its new amount
 * @returns {boolean}
 */
export function amountLockedAfterEdit(edits = []) {
  return edits.some(({ leg, amount }) =>
    !!leg?.amount_locked
    || (!!leg?.recurring_template_id
      && amount !== undefined
      && amount !== null
      && Math.abs(Number(amount)) !== Math.abs(Number(leg.amount))));
}
