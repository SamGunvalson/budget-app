import { supabase, getCurrentUser } from "./supabase";
import { newId } from "../utils/ids";

// Phase 4: the closed-account guard now lives in a Postgres BEFORE INSERT
// trigger (`assert_account_open` in supabase_phase4_mutations.sql) — no
// client-side round-trip needed. The trigger raises with the same friendly
// message the old JS guard used, so callers can surface error.message
// unchanged.

/**
 * Fetch active transactions for the current user, optionally filtered by month/year and status.
 * Joins with categories for display.
 * @param {{ month?: number, year?: number, status?: 'projected'|'pending'|'posted'|'all' }} filters
 * @returns {Promise<Array>} List of transaction objects (newest first)
 */
export async function getTransactions({ month, year, status } = {}) {
  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from("transactions")
      .select("*, categories(id, name, color, type), accounts(id, name, type)")
      .is("deleted_at", null)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (month && year) {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      const endMonth = month === 12 ? 1 : month + 1;
      const endYear = month === 12 ? year + 1 : year;
      const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;
      query = query
        .gte("transaction_date", startDate)
        .lt("transaction_date", endDate);
    }

    // Status filter: omit or pass 'all' to get everything
    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) throw error;
    allData = allData.concat(data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allData;
}

// Optional client-generated ids for the two rows of a transfer, so a retry of
// the same create is idempotent. A bulk insert needs every row to carry the
// same keys, so ids are used only when both are supplied.
function clientLegIds(firstId, secondId) {
  return firstId && secondId ? [{ id: firstId }, { id: secondId }] : [{}, {}];
}

/**
 * Create a new transaction.
 * @param {{ account_id: string, category_id: string, amount: number, description: string, payee: string, transaction_date: string, is_income: boolean, status?: string, recurring_template_id?: string }} transaction
 * @returns {Promise<Object>} Created transaction (with joined category and account)
 */
export async function createTransaction({
  account_id,
  category_id,
  amount,
  description,
  payee,
  transaction_date,
  is_income,
  status,
  recurring_template_id,
  id,
}) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authenticated");

  const row = {
    user_id: user.id,
    account_id,
    category_id,
    amount,
    description: description?.trim() ?? "",
    payee: payee?.trim() || null,
    transaction_date,
    is_income,
  };
  if (status) row.status = status;
  if (recurring_template_id) row.recurring_template_id = recurring_template_id;
  // Optional client-generated id so a retry of the same create is idempotent.
  if (id) row.id = id;

  const { data, error } = await supabase
    .from("transactions")
    .insert(row)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create a single-account balance adjustment.
 * Uses a transfer-type category so it is excluded from income/expense totals
 * but still affects the account's running balance.
 * No transfer_group_id — stored as a single row by design.
 *
 * @param {{ account_id: string, category_id: string, amount: number, description: string, payee: string, transaction_date: string, is_income: boolean, status?: string }} params
 * @returns {Promise<Object>} Created transaction
 */
export async function createAdjustment({
  account_id,
  category_id,
  amount,
  description,
  payee,
  transaction_date,
  is_income,
  status,
  id,
}) {
  const user = await getCurrentUser();

  const row = {
    user_id: user.id,
    account_id,
    category_id,
    amount,
    description: description?.trim() ?? "",
    payee: payee?.trim() || null,
    transaction_date,
    is_income,
    // Intentionally no transfer_group_id — single leg by design
  };
  if (status) row.status = status;
  if (id) row.id = id;

  const { data, error } = await supabase
    .from("transactions")
    .insert(row)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update a single-account balance adjustment.
 * Thin wrapper around updateTransaction for semantic clarity.
 *
 * @param {string} id - Transaction UUID
 * @param {{ account_id?: string, category_id?: string, amount?: number, description?: string, payee?: string, transaction_date?: string, is_income?: boolean, status?: string }} updates
 * @returns {Promise<Object>} Updated transaction
 */
export async function updateAdjustment(id, updates) {
  return updateTransaction(id, updates);
}

/**
 * Create a transfer between two accounts (dual-entry).
 * Generates a shared transfer_group_id linking both transactions.
 *
 * @param {{ from_account_id: string, to_account_id: string, amount: number, description: string, transaction_date: string, category_id: string }} transfer
 * @returns {Promise<Object[]>} Array of the two created transactions
 */
export async function createTransfer({
  from_account_id,
  to_account_id,
  amount,
  description,
  payee,
  transaction_date,
  category_id,
  transfer_group_id = newId(),
  outgoing_id,
  incoming_id,
}) {
  const user = await getCurrentUser();
  const legIds = clientLegIds(outgoing_id, incoming_id);

  const baseTx = {
    user_id: user.id,
    category_id,
    amount,
    description: description.trim(),
    payee: payee?.trim() || null,
    transaction_date,
    transfer_group_id,
  };

  const { data, error } = await supabase
    .from("transactions")
    .insert([
      { ...baseTx, ...legIds[0], account_id: from_account_id, is_income: false },
      { ...baseTx, ...legIds[1], account_id: to_account_id, is_income: true },
    ])
    .select("*, categories(id, name, color, type), accounts(id, name, type)");
  if (error) throw error;

  return [data.find((row) => !row.is_income), data.find((row) => row.is_income)];
}

/**
 * Create a "linked transfer" — a budget-impacting transaction on one account
 * with an auto-created neutral companion on another.
 *
 * The main leg keeps the user's chosen category and is_income flag (so it
 * affects budgets/analytics). The companion leg gets the "Account Transfer"
 * category (type='transfer') and is therefore excluded from all budget
 * calculations, but still updates the linked account's balance.
 *
 * Both legs share a transfer_group_id for pairing.
 *
 * @param {{ account_id, linked_account_id, category_id, amount, description, payee, transaction_date, is_income }} params
 * @returns {Promise<Object[]>} [mainLeg, companionLeg]
 */
export async function createLinkedTransfer({
  account_id,
  linked_account_id,
  category_id,
  amount,
  description,
  payee,
  transaction_date,
  is_income,
  companion_amount,
  transfer_group_id = newId(),
  id,
  companion_id,
}) {
  const user = await getCurrentUser();
  const legIds = clientLegIds(id, companion_id);

  // Resolve the "Account Transfer" category for the companion leg
  const { data: transferCats, error: catErr } = await supabase
    .from("categories")
    .select("id")
    .eq("user_id", user.id)
    .eq("type", "transfer")
    .eq("is_active", true)
    .eq("is_archived", false)
    .ilike("name", "Account Transfer")
    .limit(1);
  if (catErr) throw catErr;
  if (!transferCats?.length)
    throw new Error('No available "Account Transfer" category found. Create or restore it in Categories.');
  const companionCategoryId = transferCats[0].id;

  const sharedFields = {
    user_id: user.id,
    description: description.trim(),
    payee: payee?.trim() || null,
    transaction_date,
    transfer_group_id,
  };

  // Companion leg — neutral (transfer category), opposite is_income.
  // If companion_amount is provided and differs from amount, the companion leg
  // uses that amount instead (asymmetric linked transfer).
  const companionAmt =
    companion_amount != null && companion_amount !== amount
      ? companion_amount
      : amount;
  const { data, error } = await supabase
    .from("transactions")
    .insert([
      { ...sharedFields, ...legIds[0], account_id, category_id, is_income, amount },
      {
        ...sharedFields,
        ...legIds[1],
        amount: companionAmt,
        account_id: linked_account_id,
        category_id: companionCategoryId,
        is_income: !is_income,
      },
    ])
    .select("*, categories(id, name, color, type), accounts(id, name, type)");
  if (error) throw error;

  return [data.find((row) => row.account_id === account_id), data.find((row) => row.account_id === linked_account_id)];
}

/**
 * Update both legs of a linked transfer.
 * The main leg's category is user-chosen; the companion stays "Account Transfer".
 *
 * @param {string} id - ID of the main leg
 * @param {{ account_id, linked_account_id, category_id, amount, description, payee, transaction_date, is_income }} updates
 * @returns {Promise<Object[]>} [updatedMain, updatedCompanion]
 */
export async function updateLinkedTransfer(
  id,
  {
    account_id,
    linked_account_id,
    category_id,
    amount,
    description,
    payee,
    transaction_date,
    is_income,
    companion_amount,
  },
) {
  // Find the transaction to get its transfer_group_id
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", id)
    .single();
  if (txErr) throw txErr;
  if (!tx.transfer_group_id)
    throw new Error("Transaction is not part of a linked transfer.");

  // Find both legs
  const { data: legs, error: legsErr } = await supabase
    .from("transactions")
    .select("*, categories(id, name, color, type)")
    .eq("transfer_group_id", tx.transfer_group_id)
    .is("deleted_at", null);
  if (legsErr) throw legsErr;
  if (!legs || legs.length < 2)
    throw new Error("Linked transfer companion not found.");

  // Identify main (non-transfer category) and companion (transfer category)
  const mainLeg = legs.find((l) => l.categories?.type !== "transfer");
  const companionLeg = legs.find((l) => l.categories?.type === "transfer");
  if (!mainLeg || !companionLeg)
    throw new Error("Linked transfer legs are malformed.");

  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const sharedBase = {
    description: description?.trim() || "",
    payee: payee?.trim() || null,
    transaction_date,
    updated_at: now,
  };

  // Update main leg
  const { data: updatedMain, error: mainErr } = await supabase
    .from("transactions")
    .update({ ...sharedBase, amount, account_id, category_id, is_income })
    .eq("id", mainLeg.id)
    .eq("user_id", user.id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (mainErr) throw mainErr;

  // Update companion leg (keep its transfer category, flip is_income).
  // If companion_amount is provided, the companion uses that instead of amount
  // (asymmetric linked transfer — e.g. principal portion < total payment).
  const companionAmt =
    companion_amount != null && companion_amount !== amount
      ? companion_amount
      : amount;
  const { data: updatedCompanion, error: compErr } = await supabase
    .from("transactions")
    .update({ ...sharedBase, amount: companionAmt, account_id: linked_account_id, is_income: !is_income })
    .eq("id", companionLeg.id)
    .eq("user_id", user.id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (compErr) throw compErr;

  return [updatedMain, updatedCompanion];
}

/**
 * Update an existing transaction.
 * @param {string} id - Transaction UUID
 * @param {{ category_id?: string, amount?: number, description?: string, payee?: string, transaction_date?: string, is_income?: boolean }} updates
 * @returns {Promise<Object>} Updated transaction (with joined category)
 */
export async function updateTransaction(id, updates) {
  const user = await getCurrentUser();

  const payload = {};
  if (updates.account_id !== undefined) payload.account_id = updates.account_id;
  if (updates.category_id !== undefined)
    payload.category_id = updates.category_id;
  if (updates.amount !== undefined) payload.amount = updates.amount;
  if (updates.description !== undefined)
    payload.description = updates.description.trim();
  if (updates.payee !== undefined)
    payload.payee = updates.payee?.trim() || null;
  if (updates.transaction_date !== undefined)
    payload.transaction_date = updates.transaction_date;
  if (updates.is_income !== undefined) payload.is_income = updates.is_income;
  if (updates.status !== undefined) payload.status = updates.status;
  payload.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("transactions")
    .update(payload)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Fetch all active transactions for the current user from Jan 1 of the given
 * year through the end of throughMonth (inclusive). Used for YTD calculations.
 * @param {{ year: number, throughMonth: number }} params
 * @returns {Promise<Array>}
 */
export async function getTransactionsYTD({ year, throughMonth }) {
  const startDate = `${year}-01-01`;
  const endMonth = throughMonth === 12 ? 1 : throughMonth + 1;
  const endYear = throughMonth === 12 ? year + 1 : year;
  const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("transactions")
      .select("*, categories(id, name, color, type), accounts(id, name, type)")
      .is("deleted_at", null)
      .gte("transaction_date", startDate)
      .lt("transaction_date", endDate)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    allData = allData.concat(data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allData;
}

/**
 * Fetch all active transactions for a full year (Jan 1 – Dec 31).
 * Paginates through Supabase's 1000-row limit to ensure all rows are returned.
 * @param {{ year: number }} params
 * @returns {Promise<Array>}
 */
export async function getTransactionsForYear({ year }) {
  const startDate = `${year}-01-01`;
  const endDate = `${year + 1}-01-01`;

  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("transactions")
      .select("*, categories(id, name, color, type), accounts(id, name, type)")
      .is("deleted_at", null)
      .gte("transaction_date", startDate)
      .lt("transaction_date", endDate)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    allData = allData.concat(data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  return allData;
}

/**
 * Create an asymmetric transfer between two accounts.
 * The outgoing leg debits `from_amount` from the source account; the incoming
 * leg credits `to_amount` to the destination account. The difference (if any)
 * is not recorded — it represents interest, fees, or other costs that "poof".
 *
 * Both legs share a transfer_group_id so they display and delete together.
 *
 * @param {{ from_account_id: string, to_account_id: string, from_amount: number, to_amount: number, description: string, payee?: string, transaction_date: string, category_id: string, status?: string }} params
 * @returns {Promise<Object[]>} [outgoing, incoming]
 */
export async function createAsymmetricTransfer({
  from_account_id,
  to_account_id,
  from_amount,
  to_amount,
  description,
  payee,
  transaction_date,
  category_id,
  status,
  transfer_group_id = newId(),
  outgoing_id,
  incoming_id,
}) {
  const user = await getCurrentUser();
  const legIds = clientLegIds(outgoing_id, incoming_id);

  const base = {
    user_id: user.id,
    category_id,
    description: description.trim(),
    payee: payee?.trim() || null,
    transaction_date,
    transfer_group_id,
  };
  if (status) base.status = status;

  const { data, error } = await supabase
    .from("transactions")
    .insert([
      { ...base, ...legIds[0], account_id: from_account_id, amount: from_amount, is_income: false },
      { ...base, ...legIds[1], account_id: to_account_id, amount: to_amount, is_income: true },
    ])
    .select("*, categories(id, name, color, type), accounts(id, name, type)");
  if (error) throw error;

  return [data.find((row) => !row.is_income), data.find((row) => row.is_income)];
}

/**
 * Update both legs of an existing asymmetric transfer.
 * Each leg can have a different amount (from_amount for the outgoing leg,
 * to_amount for the incoming leg).
 *
 * @param {string} id - ID of either leg of the transfer
 * @param {{ from_account_id: string, to_account_id: string, from_amount: number, to_amount: number, description: string, payee?: string, transaction_date: string, category_id: string }} updates
 * @returns {Promise<Object[]>} [updatedOutgoing, updatedIncoming]
 */
export async function updateAsymmetricTransfer(
  id,
  {
    from_account_id,
    to_account_id,
    from_amount,
    to_amount,
    description,
    payee,
    transaction_date,
    category_id,
  },
) {
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", id)
    .single();
  if (txErr) throw txErr;
  if (!tx.transfer_group_id)
    throw new Error("Transaction is not part of a transfer.");

  const { data: legs, error: legsErr } = await supabase
    .from("transactions")
    .select("*")
    .eq("transfer_group_id", tx.transfer_group_id)
    .is("deleted_at", null);
  if (legsErr) throw legsErr;
  if (!legs || legs.length < 2)
    throw new Error("Transfer companion not found.");

  const outgoingLeg = legs.find((l) => !l.is_income);
  const incomingLeg = legs.find((l) => l.is_income);
  if (!outgoingLeg || !incomingLeg)
    throw new Error("Transfer legs are malformed.");

  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const shared = {
    category_id,
    description: description?.trim() || "",
    payee: payee?.trim() || null,
    transaction_date,
    updated_at: now,
  };

  const { data: updatedOut, error: outErr } = await supabase
    .from("transactions")
    .update({ ...shared, account_id: from_account_id, amount: from_amount })
    .eq("id", outgoingLeg.id)
    .eq("user_id", user.id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (outErr) throw outErr;

  const { data: updatedIn, error: inErr } = await supabase
    .from("transactions")
    .update({ ...shared, account_id: to_account_id, amount: to_amount })
    .eq("id", incomingLeg.id)
    .eq("user_id", user.id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (inErr) throw inErr;

  return [updatedOut, updatedIn];
}

/**
 * Update both legs of an existing transfer transaction.
 * Finds the companion transaction via transfer_group_id and updates both.
 *
 * @param {string} id - ID of either leg of the transfer
 * @param {{ from_account_id: string, to_account_id: string, amount: number, description: string, payee: string, transaction_date: string, category_id: string }} updates
 * @returns {Promise<Object[]>} Array of the two updated transactions
 */
export async function updateTransfer(
  id,
  {
    from_account_id,
    to_account_id,
    amount,
    description,
    payee,
    transaction_date,
    category_id,
  },
) {
  // Find the transaction to get its transfer_group_id
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", id)
    .single();
  if (txErr) throw txErr;
  if (!tx.transfer_group_id)
    throw new Error("Transaction is not part of a transfer.");

  // Find both legs by transfer_group_id
  const { data: legs, error: legsErr } = await supabase
    .from("transactions")
    .select("*")
    .eq("transfer_group_id", tx.transfer_group_id)
    .is("deleted_at", null);
  if (legsErr) throw legsErr;
  if (!legs || legs.length < 2)
    throw new Error("Transfer companion not found.");

  const outgoingLeg = legs.find((l) => !l.is_income);
  const incomingLeg = legs.find((l) => l.is_income);
  if (!outgoingLeg || !incomingLeg)
    throw new Error("Transfer legs are malformed.");

  const user = await getCurrentUser();
  const now = new Date().toISOString();
  const shared = {
    category_id,
    amount,
    description: description?.trim() || "",
    payee: payee?.trim() || null,
    transaction_date,
    updated_at: now,
  };

  // Update outgoing leg (from account)
  const { data: updatedOut, error: outErr } = await supabase
    .from("transactions")
    .update({ ...shared, account_id: from_account_id })
    .eq("id", outgoingLeg.id)
    .eq("user_id", user.id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (outErr) throw outErr;

  // Update incoming leg (to account)
  const { data: updatedIn, error: inErr } = await supabase
    .from("transactions")
    .update({ ...shared, account_id: to_account_id })
    .eq("id", incomingLeg.id)
    .eq("user_id", user.id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (inErr) throw inErr;

  return [updatedOut, updatedIn];
}

/**
 * Soft-delete a transaction by setting deleted_at via RPC.
 * If the transaction has a transfer_group_id, also deletes the companion leg.
 * @param {string} id - Transaction UUID
 * @returns {Promise<string[]>} Array of deleted transaction IDs
 */
export async function deleteTransaction(id) {
  const user = await getCurrentUser();

  // Check if this transaction has a companion (transfer or linked transfer)
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("id, transfer_group_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .single();

  if (txErr) {
    // Fallback: just delete the single transaction
    const { error } = await supabase.rpc("soft_delete_transaction", {
      txn_id: id,
    });
    if (error) throw error;
    return [id];
  }

  const deletedIds = [id];

  if (tx.transfer_group_id) {
    // Find the companion leg
    const { data: companions, error: lookupErr } = await supabase
      .from("transactions")
      .select("id")
      .eq("transfer_group_id", tx.transfer_group_id)
      .eq("user_id", user.id)
      .neq("id", id)
      .is("deleted_at", null);
    // A pair must not be left half-deleted: if the companion cannot be found
    // or deleted, fail before touching the original so the caller can retry.
    if (lookupErr) throw lookupErr;

    if (companions?.length) {
      for (const comp of companions) {
        const { error: compErr } = await supabase.rpc(
          "soft_delete_transaction",
          { txn_id: comp.id },
        );
        if (compErr) throw compErr;
        deletedIds.push(comp.id);
      }
    }
  }

  // Delete the original transaction
  const { error } = await supabase.rpc("soft_delete_transaction", {
    txn_id: id,
  });
  if (error) throw error;

  return deletedIds;
}

/**
 * Bulk-update multiple transactions. Each item must have an `id` plus any update fields.
 * Returns updated rows with joined categories and accounts.
 *
 * Phase 4: a single Postgres RPC (`bulk_update_transactions`) replaces the
 * per-row UPDATE fan-out. The RPC honors the same field semantics as
 * `updateTransaction` — fields absent from each input object are left
 * untouched; explicit `null` clears the column where the schema allows it.
 *
 * @param {Array<{id: string, [key: string]: any}>} updates
 * @returns {Promise<Array>}
 */
export async function bulkUpdateTransactions(updates) {
  if (!Array.isArray(updates) || updates.length === 0) return [];

  // Strip undefined fields so the RPC treats them as "leave alone".
  const cleaned = updates.map(({ id, ...fields }) => {
    const out = { id };
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      // Match updateTransaction's trim/normalize behavior so the RPC sees the
      // same shape the per-row path used to write.
      if (k === "description" && typeof v === "string") out[k] = v.trim();
      else if (k === "payee" && typeof v === "string")
        out[k] = v.trim() || null;
      else out[k] = v;
    }
    return out;
  });

  const { data, error } = await supabase.rpc("bulk_update_transactions", {
    p_updates: cleaned,
  });
  if (error) throw error;
  return data || [];
}

/**
 * Bulk soft-delete multiple transactions.
 * @param {string[]} ids - Array of transaction UUIDs
 * @returns {Promise<void>}
 */
export async function bulkDeleteTransactions(ids) {
  await Promise.all(ids.map((id) => deleteTransaction(id)));
}

// ── Status lifecycle functions ──

/**
 * Find the live, not-yet-posted companion legs of a transaction (the other
 * rows sharing its transfer_group_id). Posted companions are left alone:
 * confirm has nothing to do for them and skip must never remove posted rows.
 * @param {string} id - Transaction UUID
 * @returns {Promise<string[]>} Companion transaction IDs (empty if unpaired)
 */
async function getUnpostedCompanionIds(id) {
  const { data: tx, error: txErr } = await supabase
    .from("transactions")
    .select("id, transfer_group_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (txErr) throw txErr;
  if (!tx?.transfer_group_id) return [];

  const { data: companions, error: compErr } = await supabase
    .from("transactions")
    .select("id")
    .eq("transfer_group_id", tx.transfer_group_id)
    .neq("id", id)
    .in("status", ["projected", "pending"])
    .is("deleted_at", null);
  if (compErr) throw compErr;
  return (companions || []).map((row) => row.id);
}

/**
 * Confirm a transaction and its unposted companion legs. Companions are
 * confirmed first, so a failure leaves the requested row still pending.
 * @param {string} id - Transaction UUID
 * @returns {Promise<Object[]>} Updated rows, the requested transaction first
 */
async function confirmWithCompanions(id) {
  const user = await getCurrentUser();
  const companionIds = await getUnpostedCompanionIds(id);
  const now = new Date().toISOString();

  let companions = [];
  if (companionIds.length) {
    const { data, error: compErr } = await supabase
      .from("transactions")
      .update({ status: "posted", updated_at: now })
      .in("id", companionIds)
      .eq("user_id", user.id)
      .select("*, categories(id, name, color, type), accounts(id, name, type)");
    if (compErr) throw compErr;
    companions = data || [];
  }

  const { data, error } = await supabase
    .from("transactions")
    .update({ status: "posted", updated_at: now })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();

  if (error) throw error;
  return [data, ...companions];
}

/**
 * Soft-delete a projected/pending transaction and its unposted companion
 * legs. Companions go first, so a failure leaves the requested row in place.
 * @param {string} id - Transaction UUID
 * @returns {Promise<string[]>} Deleted IDs, the requested transaction first
 */
async function skipWithCompanions(id) {
  const companionIds = await getUnpostedCompanionIds(id);
  for (const txn_id of [...companionIds, id]) {
    const { error } = await supabase.rpc("soft_delete_transaction", { txn_id });
    if (error) throw error;
  }
  return [id, ...companionIds];
}

/** Flatten per-request results: requested items first, then extra companions. */
function requestedFirst(groups, keyOf) {
  const seen = new Set();
  const out = [];
  for (const item of [
    ...groups.map((group) => group[0]),
    ...groups.flatMap((group) => group.slice(1)),
  ]) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Confirm a pending transaction → posted. If it is one leg of a transfer or
 * linked transfer, the other unposted leg(s) are confirmed with it.
 * @param {string} id - Transaction UUID
 * @returns {Promise<Object>} Updated transaction
 */
export async function confirmTransaction(id) {
  const [confirmed] = await confirmWithCompanions(id);
  return confirmed;
}

/**
 * Skip (soft-delete) a projected or pending transaction. If it is one leg of
 * a transfer or linked transfer, the other unposted leg(s) are skipped too.
 * @param {string} id - Transaction UUID
 * @returns {Promise<string>} Deleted transaction ID
 */
export async function skipTransaction(id) {
  await skipWithCompanions(id);
  return id;
}

/**
 * Bulk-confirm multiple pending transactions → posted.
 * @param {string[]} ids - Array of transaction UUIDs
 * @returns {Promise<Array>} Updated transactions: one per requested id, in
 *   order, followed by any companion legs that were confirmed with them
 */
export async function bulkConfirmTransactions(ids) {
  const groups = await Promise.all(ids.map((id) => confirmWithCompanions(id)));
  return requestedFirst(groups, (row) => row.id);
}

/**
 * Bulk-skip (soft-delete) multiple pending/projected transactions.
 * @param {string[]} ids - Array of transaction UUIDs
 * @returns {Promise<string[]>} Deleted IDs: the requested ids, in order,
 *   followed by any companion legs that were skipped with them
 */
export async function bulkSkipTransactions(ids) {
  const groups = await Promise.all(ids.map((id) => skipWithCompanions(id)));
  return requestedFirst(groups, (id) => id);
}

/**
 * Fetch all distinct years that have at least one active transaction.
 * Returns an array of years in ascending order, including a one-year
 * look-ahead (current year + 1) so users can budget ahead.
 *
 * Backed by the `get_transaction_years` Postgres RPC (Phase 3).
 *
 * @returns {Promise<number[]>} e.g. [2022, 2023, 2024, 2025, 2026, 2027]
 */
export async function getTransactionYears() {
  const { data, error } = await supabase.rpc("get_transaction_years");
  if (error) throw error;
  return (data || []).map((y) => Number(y));
}

/**
 * Get count of pending transactions that need review (manual confirm).
 * @returns {Promise<number>}
 */
export async function getPendingReviewCount() {
  const { count, error } = await supabase
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("status", "pending");

  if (error) throw error;
  return count || 0;
}
