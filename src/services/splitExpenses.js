import { supabase, getCurrentUser } from "./supabase";

/**
 * Compute payer_share, partner_share, and paidByUserId from a template's
 * split configuration. Used by both the auto-confirm path (service layer) and
 * the manual-confirm path (TransactionsPage) so the logic is not duplicated.
 *
 * @param {number} totalCents - Total expense amount in cents (positive)
 * @param {'equal'|'full'|'custom'} splitMethod
 * @param {'me'|'partner'} splitPayer - Who paid ('me' = current user)
 * @param {number|null} splitPartnerSharePct - Partner's share % (0–100); only for 'custom'
 * @param {string} currentUserId
 * @param {string} partnerId
 * @returns {{ payerShare: number, partnerShare: number, paidByUserId: string }}
 */
export function computeShares(
  totalCents,
  splitMethod,
  splitPayer,
  splitPartnerSharePct,
  currentUserId,
  partnerId,
) {
  const paidByUserId = splitPayer === "me" ? currentUserId : partnerId;

  let payerShare, partnerShare;

  if (splitMethod === "equal") {
    const half = Math.floor(totalCents / 2);
    // Payer keeps the extra cent when odd — mirrors SplitExpenseForm logic
    payerShare = totalCents - half;
    partnerShare = half;
  } else if (splitMethod === "full") {
    // Non-payer owes the entire amount; payer owes nothing to the other
    payerShare = 0;
    partnerShare = totalCents;
  } else {
    // custom: partner owes splitPartnerSharePct% of the total
    const pct = Math.max(0, Math.min(100, splitPartnerSharePct ?? 50));
    partnerShare = Math.round((totalCents * pct) / 100);
    payerShare = totalCents - partnerShare;
  }

  return { payerShare, partnerShare, paidByUserId };
}

/**
 * Get all active (non-deleted) split expenses for a partnership.
 * @param {string} partnershipId
 * @returns {Promise<Array>} List of split expenses, newest first
 */
export async function getSplitExpenses(partnershipId) {
  const { data, error } = await supabase
    .from("split_expenses")
    .select("*")
    .eq("partnership_id", partnershipId)
    .is("deleted_at", null)
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * Create a new split expense.
 * @param {{
 *   partnershipId: string,
 *   description: string,
 *   totalAmount: number,
 *   payerShare: number,
 *   partnerShare: number,
 *   paidByUserId: string,
 *   transactionId?: string,
 *   expenseDate?: string
 * }} params
 * @returns {Promise<Object>} Created split expense
 */
export async function createSplitExpense({
  partnershipId,
  description,
  totalAmount,
  payerShare,
  partnerShare,
  paidByUserId,
  transactionId,
  expenseDate,
}) {
  if (transactionId) {
    const { data: existing, error: existingErr } = await supabase
      .from("split_expenses")
      .select("*")
      .eq("transaction_id", transactionId)
      .eq("partnership_id", partnershipId)
      .is("deleted_at", null)
      .maybeSingle();

    if (existingErr) throw existingErr;
    if (existing) return existing;
  }

  const { data, error } = await supabase
    .from("split_expenses")
    .insert({
      partnership_id: partnershipId,
      paid_by_user_id: paidByUserId,
      transaction_id: transactionId || null,
      description: description.trim(),
      total_amount: totalAmount,
      payer_share: payerShare,
      partner_share: partnerShare,
      is_settlement: false,
      expense_date: expenseDate || new Date().toISOString().split("T")[0],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create a settlement (settle-up) record.
 * @param {{
 *   partnershipId: string,
 *   amount: number,
 *   paidByUserId: string,
 *   expenseDate?: string
 * }} params
 * @returns {Promise<Object>} Created settlement record
 */
export async function createSettlement({
  partnershipId,
  amount,
  paidByUserId,
  expenseDate,
}) {
  const { data, error } = await supabase
    .from("split_expenses")
    .insert({
      partnership_id: partnershipId,
      paid_by_user_id: paidByUserId,
      description: "Settlement",
      total_amount: amount,
      payer_share: amount,
      partner_share: 0,
      is_settlement: true,
      expense_date: expenseDate || new Date().toISOString().split("T")[0],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Soft-delete a split expense.
 * @param {string} id - Split expense ID
 * @param {string} partnershipId - Partnership the expense belongs to (used for defense-in-depth RLS filter)
 */
export async function deleteSplitExpense(id, partnershipId) {
  if (!partnershipId) {
    throw new Error("deleteSplitExpense requires partnershipId");
  }

  const { error } = await supabase
    .from("split_expenses")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("partnership_id", partnershipId);

  if (error) throw error;
}

/**
 * Update an existing split expense.
 * @param {{
 *   id: string,
 *   partnershipId: string,
 *   description: string,
 *   totalAmount: number,
 *   payerShare: number,
 *   partnerShare: number,
 *   paidByUserId: string,
 *   expenseDate: string
 * }} params
 * @returns {Promise<Object>} Updated split expense
 */
export async function updateSplitExpense({
  id,
  partnershipId,
  description,
  totalAmount,
  payerShare,
  partnerShare,
  paidByUserId,
  expenseDate,
}) {
  const { data, error } = await supabase
    .from("split_expenses")
    .update({
      description: description.trim(),
      total_amount: totalAmount,
      payer_share: payerShare,
      partner_share: partnerShare,
      paid_by_user_id: paidByUserId,
      expense_date: expenseDate,
    })
    .eq("id", id)
    .eq("partnership_id", partnershipId)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Compute the net balance for a partnership from the current user's perspective.
 * Positive = partner owes you. Negative = you owe partner.
 *
 * Formula:
 *   Non-settlements: +partner_share when I paid, -partner_share when partner paid
 *   Settlements:     -total_amount when I paid partner, +total_amount when partner paid me
 *
 * @param {string} partnershipId
 * @returns {Promise<number>} Net balance in cents
 */
export async function getBalance(partnershipId) {
  const user = await getCurrentUser();
  const expenses = await getSplitExpenses(partnershipId);

  let balance = 0;
  for (const exp of expenses) {
    const iPaid = exp.paid_by_user_id === user.id;

    if (exp.is_settlement) {
      // Settlement: payer is paying off debt to the other person.
      // When I pay, my debt decreases (balance goes up); when partner pays, their debt to me decreases (balance goes down).
      balance += iPaid ? exp.total_amount : -exp.total_amount;
    } else {
      // Regular expense: non-payer owes their share
      balance += iPaid ? exp.partner_share : -exp.partner_share;
    }
  }

  return balance;
}

/**
 * Get split expense linked to a specific transaction.
 * @param {string} transactionId
 * @returns {Promise<Object|null>} Split expense or null
 */
export async function getSplitByTransaction(transactionId) {
  const { data, error } = await supabase
    .from("split_expenses")
    .select("*")
    .eq("transaction_id", transactionId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Get transaction IDs that have been split, for badge display.
 * @param {string} partnershipId
 * @returns {Promise<Set<string>>} Set of transaction IDs that are split
 */
export async function getSplitTransactionIds(partnershipId) {
  const { data, error } = await supabase
    .from("split_expenses")
    .select("transaction_id")
    .eq("partnership_id", partnershipId)
    .is("deleted_at", null)
    .not("transaction_id", "is", null);

  if (error) throw error;
  return new Set((data ?? []).map((d) => d.transaction_id));
}

// ─── Notification seen-state helpers ─────────────────────────────────────────
//
// Primary source of truth: the partnership row's user_a_seen_at / user_b_seen_at
// columns in Supabase (cross-device).  localStorage is maintained as an offline
// fallback so the correct seen-at is available immediately before the DB fetch
// completes or when the app is offline.

const SEEN_KEY = (userId) => `splitSeenAt_${userId}`;

/**
 * Write the current timestamp to localStorage as an offline fallback.
 * The authoritative server-side write is handled by markSplitsSeenDB in partnerships.js.
 * @param {string} userId
 */
export function markSplitsSeenLocal(userId) {
  if (!userId) return;
  try {
    localStorage.setItem(SEEN_KEY(userId), new Date().toISOString());
  } catch {
    /* storage unavailable */
  }
}

/**
 * Get the best available "last seen at" timestamp for this user.
 *
 * Priority:
 *   1. dbSeenAt — value from the partnership row (cross-device, passed by the caller)
 *   2. localStorage — fallback for offline / before the DB value loads
 *
 * Returns null if never seen on any device.
 *
 * @param {string} userId
 * @param {string|null} dbSeenAt - Value from partnership.user_a_seen_at or user_b_seen_at
 * @returns {string|null} ISO timestamp or null
 */
export function getLastSeenSplitsAt(userId, dbSeenAt = null) {
  if (!userId) return null;

  // Use whichever is more recent: the DB value or the local cache
  const localSeenAt = (() => {
    try {
      return localStorage.getItem(SEEN_KEY(userId));
    } catch {
      return null;
    }
  })();

  if (dbSeenAt && localSeenAt) {
    // Parse to ms to handle mixed ISO formats (e.g. Supabase "+00:00" vs JS "Z")
    const dbMs = Date.parse(dbSeenAt);
    const localMs = Date.parse(localSeenAt);
    if (!isNaN(dbMs) && !isNaN(localMs)) return dbMs >= localMs ? dbSeenAt : localSeenAt;
    if (!isNaN(dbMs)) return dbSeenAt;
    if (!isNaN(localMs)) return localSeenAt;
    return null;
  }
  return dbSeenAt ?? localSeenAt;
}
