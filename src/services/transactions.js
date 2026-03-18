import { supabase, getCurrentUser } from "./supabase";

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
}) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;

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
}) {
  const user = await getCurrentUser();
  const transfer_group_id = crypto.randomUUID();

  const baseTx = {
    user_id: user.id,
    category_id,
    amount,
    description: description.trim(),
    payee: payee?.trim() || null,
    transaction_date,
    transfer_group_id,
  };

  // Outgoing (from source account) — always expense side
  const { data: outgoing, error: outErr } = await supabase
    .from("transactions")
    .insert({ ...baseTx, account_id: from_account_id, is_income: false })
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (outErr) throw outErr;

  // Incoming (to destination account) — always income side
  const { data: incoming, error: inErr } = await supabase
    .from("transactions")
    .insert({ ...baseTx, account_id: to_account_id, is_income: true })
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (inErr) throw inErr;

  return [outgoing, incoming];
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
}) {
  const user = await getCurrentUser();
  const transfer_group_id = crypto.randomUUID();

  // Resolve the "Account Transfer" category for the companion leg
  const { data: transferCats, error: catErr } = await supabase
    .from("categories")
    .select("id")
    .eq("user_id", user.id)
    .eq("type", "transfer")
    .ilike("name", "Account Transfer")
    .limit(1);
  if (catErr) throw catErr;
  if (!transferCats?.length)
    throw new Error('No "Account Transfer" category found. Please create one.');
  const companionCategoryId = transferCats[0].id;

  const sharedFields = {
    user_id: user.id,
    amount,
    description: description.trim(),
    payee: payee?.trim() || null,
    transaction_date,
    transfer_group_id,
  };

  // Main leg — budget-impacting (user's real category)
  const { data: mainLeg, error: mainErr } = await supabase
    .from("transactions")
    .insert({ ...sharedFields, account_id, category_id, is_income })
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (mainErr) throw mainErr;

  // Companion leg — neutral (transfer category), opposite is_income
  const { data: companionLeg, error: compErr } = await supabase
    .from("transactions")
    .insert({
      ...sharedFields,
      account_id: linked_account_id,
      category_id: companionCategoryId,
      is_income: !is_income,
    })
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (compErr) throw compErr;

  return [mainLeg, companionLeg];
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

  const now = new Date().toISOString();
  const shared = {
    amount,
    description: description?.trim() || "",
    payee: payee?.trim() || null,
    transaction_date,
    updated_at: now,
  };

  // Update main leg
  const { data: updatedMain, error: mainErr } = await supabase
    .from("transactions")
    .update({ ...shared, account_id, category_id, is_income })
    .eq("id", mainLeg.id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (mainErr) throw mainErr;

  // Update companion leg (keep its transfer category, flip is_income)
  const { data: updatedCompanion, error: compErr } = await supabase
    .from("transactions")
    .update({ ...shared, account_id: linked_account_id, is_income: !is_income })
    .eq("id", companionLeg.id)
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
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (outErr) throw outErr;

  // Update incoming leg (to account)
  const { data: updatedIn, error: inErr } = await supabase
    .from("transactions")
    .update({ ...shared, account_id: to_account_id })
    .eq("id", incomingLeg.id)
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
    const { data: companions } = await supabase
      .from("transactions")
      .select("id")
      .eq("transfer_group_id", tx.transfer_group_id)
      .eq("user_id", user.id)
      .neq("id", id)
      .is("deleted_at", null);

    if (companions?.length) {
      for (const comp of companions) {
        const { error: compErr } = await supabase.rpc(
          "soft_delete_transaction",
          { txn_id: comp.id },
        );
        if (compErr)
          console.error(`Failed to delete companion ${comp.id}:`, compErr);
        else deletedIds.push(comp.id);
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
 * Returns updated rows with joined categories.
 * @param {Array<{id: string, [key: string]: any}>} updates
 * @returns {Promise<Array>}
 */
export async function bulkUpdateTransactions(updates) {
  const results = await Promise.all(
    updates.map(({ id, ...fields }) => updateTransaction(id, fields)),
  );
  return results;
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
 * Confirm a pending transaction → posted.
 * @param {string} id - Transaction UUID
 * @returns {Promise<Object>} Updated transaction
 */
export async function confirmTransaction(id) {
  const { data, error } = await supabase
    .from("transactions")
    .update({ status: "posted", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Skip (soft-delete) a projected or pending transaction.
 * @param {string} id - Transaction UUID
 * @returns {Promise<string>} Deleted transaction ID
 */
export async function skipTransaction(id) {
  const { error } = await supabase.rpc("soft_delete_transaction", {
    txn_id: id,
  });
  if (error) throw error;
  return id;
}

/**
 * Bulk-confirm multiple pending transactions → posted.
 * @param {string[]} ids - Array of transaction UUIDs
 * @returns {Promise<Array>} Updated transactions
 */
export async function bulkConfirmTransactions(ids) {
  const results = await Promise.all(ids.map((id) => confirmTransaction(id)));
  return results;
}

/**
 * Bulk-skip (soft-delete) multiple pending/projected transactions.
 * @param {string[]} ids - Array of transaction UUIDs
 * @returns {Promise<string[]>} Array of deleted IDs
 */
export async function bulkSkipTransactions(ids) {
  await Promise.all(ids.map((id) => skipTransaction(id)));
  return ids;
}

/**
 * Fetch all distinct years that have at least one active transaction.
 * Returns an array of years in ascending order, including a one-year
 * look-ahead (current year + 1) so users can budget ahead.
 * @returns {Promise<number[]>} e.g. [2022, 2023, 2024, 2025, 2026, 2027]
 */
export async function getTransactionYears() {
  const { data, error } = await supabase
    .from("transactions")
    .select("transaction_date")
    .is("deleted_at", null)
    .order("transaction_date", { ascending: true })
    .limit(1);

  if (error) throw error;

  const currentYear = new Date().getFullYear();
  const minYear = data?.length
    ? new Date(data[0].transaction_date).getFullYear()
    : currentYear;
  const maxYear = currentYear + 1;

  return Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
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
