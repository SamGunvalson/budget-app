import { supabase, getCurrentUser } from "./supabase";
import { format, addDays, startOfDay, isAfter } from "date-fns";
import {
  getPendingOccurrences,
  getOccurrencesInRange,
} from "../utils/recurringCalculations";

// ── Concurrency guard for generateProjectedTransactions ──
// Prevents duplicate projected transactions when the function is called
// concurrently (e.g., React StrictMode double-firing useEffect, or multiple
// browser tabs running initializeRecurringCycle at the same time).
let _generatingPromise = null;

// ── CRUD ──

/**
 * Fetch all active recurring templates for the current user.
 * Joins category and account (including to_account for transfers) for display.
 * Groups: top-level list returns parents + standalone templates.
 * Children are nested under their parent's `children` array.
 * @returns {Promise<Array>}
 */
export async function getRecurringTemplates() {
  const { data, error } = await supabase
    .from("recurring_templates")
    .select(
      "*, categories(id, name, color, type), accounts!recurring_templates_account_id_fkey(id, name, type), to_accounts:accounts!recurring_templates_to_account_id_fkey(id, name, type)",
    )
    .eq("is_active", true)
    .order("description");

  if (error) throw error;

  // Separate parents/standalone from children
  const childMap = new Map(); // group_id -> [children]
  const topLevel = [];

  for (const t of data) {
    // Flatten to_accounts join (Supabase returns it as an object or null)
    t.to_account = t.to_accounts || null;
    delete t.to_accounts;

    // Skip paused templates
    if (t.is_paused) continue;

    if (t.group_id) {
      // This is a child of a group
      if (!childMap.has(t.group_id)) childMap.set(t.group_id, []);
      childMap.get(t.group_id).push(t);
    } else {
      topLevel.push(t);
    }
  }

  // Attach children to their parent, sorted by group_order
  for (const t of topLevel) {
    if (t.is_group_parent) {
      const children = childMap.get(t.id) || [];
      children.sort((a, b) => (a.group_order || 0) - (b.group_order || 0));
      t.children = children;
    }
  }

  return topLevel;
}

/**
 * Create a new recurring template.
 * @param {Object} template
 * @returns {Promise<Object>} created template with joins
 */
export async function createRecurringTemplate({
  account_id,
  category_id,
  description,
  payee,
  amount,
  is_income,
  frequency,
  day_of_month,
  day_of_month_2,
  day_of_week,
  start_date,
  end_date,
  to_account_id,
  is_transfer,
  group_id,
  is_group_parent,
  group_order,
}) {
  const user = await getCurrentUser();

  const { data, error } = await supabase
    .from("recurring_templates")
    .insert({
      user_id: user.id,
      account_id,
      category_id,
      description: description?.trim() ?? "",
      payee: payee?.trim() || null,
      amount,
      is_income: is_income || false,
      frequency,
      day_of_month: day_of_month || null,
      day_of_month_2: day_of_month_2 || null,
      day_of_week: day_of_week != null ? day_of_week : null,
      start_date,
      end_date: end_date || null,
      to_account_id: to_account_id || null,
      is_transfer: is_transfer || false,
      group_id: group_id || null,
      is_group_parent: is_group_parent || false,
      group_order: group_order || 0,
    })
    .select(
      "*, categories(id, name, color, type), accounts!recurring_templates_account_id_fkey(id, name, type)",
    )
    .single();

  if (error) throw error;
  return data;
}

/**
 * Create a recurring group (parent + children) in one operation.
 * @param {Object} parentData - Parent template fields
 * @param {Array<Object>} childrenData - Array of child template fields
 * @returns {Promise<Object>} parent template with children attached
 */
export async function createRecurringGroup(parentData, childrenData) {
  // Create the parent first
  const parent = await createRecurringTemplate({
    ...parentData,
    is_group_parent: true,
  });

  // Create each child linked to the parent
  const children = [];
  for (let i = 0; i < childrenData.length; i++) {
    const child = await createRecurringTemplate({
      ...childrenData[i],
      group_id: parent.id,
      group_order: i,
      // Children inherit parent schedule
      frequency: parentData.frequency,
      day_of_month: parentData.day_of_month,
      day_of_month_2: parentData.day_of_month_2,
      day_of_week: parentData.day_of_week,
      start_date: parentData.start_date,
      end_date: parentData.end_date,
    });
    children.push(child);
  }

  parent.children = children;
  return parent;
}

/**
 * Update a recurring template.
 * @param {string} id
 * @param {Object} updates
 * @returns {Promise<Object>}
 */
export async function updateRecurringTemplate(id, updates) {
  const payload = {};
  if (updates.account_id !== undefined) payload.account_id = updates.account_id;
  if (updates.category_id !== undefined)
    payload.category_id = updates.category_id;
  if (updates.description !== undefined)
    payload.description = updates.description?.trim() ?? "";
  if (updates.payee !== undefined)
    payload.payee = updates.payee?.trim() || null;
  if (updates.amount !== undefined) payload.amount = updates.amount;
  if (updates.is_income !== undefined) payload.is_income = updates.is_income;
  if (updates.frequency !== undefined) payload.frequency = updates.frequency;
  if (updates.day_of_month !== undefined)
    payload.day_of_month = updates.day_of_month || null;
  if (updates.day_of_month_2 !== undefined)
    payload.day_of_month_2 = updates.day_of_month_2 || null;
  if (updates.day_of_week !== undefined)
    payload.day_of_week =
      updates.day_of_week != null ? updates.day_of_week : null;
  if (updates.start_date !== undefined) payload.start_date = updates.start_date;
  if (updates.end_date !== undefined)
    payload.end_date = updates.end_date || null;
  if (updates.to_account_id !== undefined)
    payload.to_account_id = updates.to_account_id || null;
  if (updates.is_transfer !== undefined)
    payload.is_transfer = updates.is_transfer;
  if (updates.is_group_parent !== undefined)
    payload.is_group_parent = updates.is_group_parent;
  if (updates.group_order !== undefined)
    payload.group_order = updates.group_order;
  if (updates.auto_confirm !== undefined)
    payload.auto_confirm = updates.auto_confirm;
  if (updates.is_paused !== undefined)
    payload.is_paused = updates.is_paused;

  const { data, error } = await supabase
    .from("recurring_templates")
    .update(payload)
    .eq("id", id)
    .select(
      "*, categories(id, name, color, type), accounts!recurring_templates_account_id_fkey(id, name, type)",
    )
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update a recurring group (parent + children).
 * Deletes removed children, updates existing, creates new.
 * @param {string} groupId - Parent template ID
 * @param {Object} parentData - Updated parent fields
 * @param {Array<Object>} childrenData - Updated child fields (with optional `id` for existing)
 * @returns {Promise<Object>}
 */
export async function updateRecurringGroup(groupId, parentData, childrenData) {
  // Update the parent
  await updateRecurringTemplate(groupId, {
    ...parentData,
    is_group_parent: true,
  });

  // Get existing children
  const { data: existingChildren, error: fetchErr } = await supabase
    .from("recurring_templates")
    .select("id")
    .eq("group_id", groupId)
    .eq("is_active", true);
  if (fetchErr) throw fetchErr;

  const existingIds = new Set(existingChildren.map((c) => c.id));
  const updatedIds = new Set();

  // Upsert children
  for (let i = 0; i < childrenData.length; i++) {
    const child = childrenData[i];
    const childPayload = {
      ...child,
      group_id: groupId,
      group_order: i,
      // Inherit parent schedule
      frequency: parentData.frequency,
      day_of_month: parentData.day_of_month,
      day_of_month_2: parentData.day_of_month_2,
      day_of_week: parentData.day_of_week,
      start_date: parentData.start_date,
      end_date: parentData.end_date,
    };

    if (child.id && existingIds.has(child.id)) {
      // Update existing child
      await updateRecurringTemplate(child.id, childPayload);
      updatedIds.add(child.id);
    } else {
      // Create new child
      await createRecurringTemplate(childPayload);
    }
  }

  // Soft-delete removed children
  for (const existingId of existingIds) {
    if (!updatedIds.has(existingId)) {
      await deleteRecurringTemplate(existingId);
    }
  }

  // Reload the parent with children
  const templates = await getRecurringTemplates();
  return templates.find((t) => t.id === groupId);
}

/**
 * Soft-delete all projected and pending transactions generated from a specific
 * recurring template. Call this before updating a template so stale projections
 * are cleared and regenerated with the updated settings.
 * Posted transactions are intentionally left untouched.
 * @param {string} templateId
 */
export async function clearProjectedTransactionsForTemplate(templateId) {
  const { error } = await supabase
    .from("transactions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("recurring_template_id", templateId)
    .in("status", ["projected", "pending"])
    .is("deleted_at", null);
  if (error) throw error;
}

/**
 * Soft-delete a recurring template (set is_active = false).
 * If it's a group parent, also soft-delete all children.
 * @param {string} id
 */
export async function deleteRecurringTemplate(id) {
  // Check if this is a group parent
  const { data: template } = await supabase
    .from("recurring_templates")
    .select("is_group_parent")
    .eq("id", id)
    .single();

  if (template?.is_group_parent) {
    // Soft-delete all children
    const { error: childErr } = await supabase
      .from("recurring_templates")
      .update({ is_active: false })
      .eq("group_id", id);
    if (childErr) throw childErr;
  }

  // Soft-delete the template itself
  const { error } = await supabase
    .from("recurring_templates")
    .update({ is_active: false })
    .eq("id", id);

  if (error) throw error;
}

/**
 * Pause a recurring template (set is_paused = true).
 * Paused templates are skipped during projected transaction generation.
 * @param {string} id
 */
export async function pauseRecurringTemplate(id) {
  return updateRecurringTemplate(id, { is_paused: true });
}

/**
 * Resume a paused recurring template (set is_paused = false).
 * @param {string} id
 */
export async function resumeRecurringTemplate(id) {
  return updateRecurringTemplate(id, { is_paused: false });
}

/**
 * Fetch all active recurring templates (including paused) that reference
 * a given account as account_id or to_account_id.
 * @param {string} accountId
 * @returns {Promise<Array>}
 */
export async function getTemplatesForAccount(accountId) {
  const { data, error } = await supabase
    .from("recurring_templates")
    .select("id, description, account_id, to_account_id, is_paused, group_id, is_group_parent")
    .eq("is_active", true)
    .or(`account_id.eq.${accountId},to_account_id.eq.${accountId}`);
  if (error) throw error;
  return data || [];
}

// ── Apply Logic ──

/**
 * Apply a single recurring template as a transfer (dual-entry).
 * Creates two transactions linked by transfer_group_id.
 * @param {Object} user
 * @param {Object} template
 * @param {string} dateStr
 * @param {{ status?: string, recurring_template_id?: string }} [opts]
 */
async function applyAsTransfer(user, template, dateStr, opts = {}) {
  const transfer_group_id = crypto.randomUUID();

  const baseTx = {
    user_id: user.id,
    category_id: template.category_id,
    amount: Math.abs(template.amount),
    description: template.description,
    payee: template.payee,
    transaction_date: dateStr,
    transfer_group_id,
  };
  if (opts.status) baseTx.status = opts.status;
  if (opts.recurring_template_id)
    baseTx.recurring_template_id = opts.recurring_template_id;

  // Outgoing (from source account)
  const { data: outgoing, error: outErr } = await supabase
    .from("transactions")
    .insert({ ...baseTx, account_id: template.account_id, is_income: false })
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (outErr) throw outErr;

  // Incoming (to destination account)
  const { data: incoming, error: inErr } = await supabase
    .from("transactions")
    .insert({ ...baseTx, account_id: template.to_account_id, is_income: true })
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (inErr) throw inErr;

  return [outgoing, incoming];
}

/**
 * Apply a single non-transfer template as a regular transaction.
 * @param {Object} user
 * @param {Object} template
 * @param {string} dateStr
 * @param {{ status?: string, recurring_template_id?: string }} [opts]
 */
async function applyAsTransaction(user, template, dateStr, opts = {}) {
  const row = {
    user_id: user.id,
    account_id: template.account_id,
    category_id: template.category_id,
    amount: Math.abs(template.amount),
    description: template.description,
    payee: template.payee,
    transaction_date: dateStr,
    is_income: template.is_income,
  };
  if (opts.status) row.status = opts.status;
  if (opts.recurring_template_id)
    row.recurring_template_id = opts.recurring_template_id;

  const { data, error } = await supabase
    .from("transactions")
    .insert(row)
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();

  if (error) throw error;
  return data;
}

/**
 * Apply a non-transfer template that has a linked account (to_account_id set
 * but is_transfer = false). Creates a budget-impacting main leg and a neutral
 * companion on the linked account using the "Account Transfer" category.
 * @param {Object} user
 * @param {Object} template
 * @param {string} dateStr
 * @param {{ status?: string, recurring_template_id?: string }} [opts]
 */
async function applyAsLinkedTransfer(user, template, dateStr, opts = {}) {
  const transfer_group_id = crypto.randomUUID();

  // Resolve "Account Transfer" category for companion leg
  const { data: transferCats, error: catErr } = await supabase
    .from("categories")
    .select("id")
    .eq("user_id", user.id)
    .eq("type", "transfer")
    .ilike("name", "Account Transfer")
    .limit(1);
  if (catErr) throw catErr;
  if (!transferCats?.length)
    throw new Error('No "Account Transfer" category found.');
  const companionCategoryId = transferCats[0].id;

  const sharedFields = {
    user_id: user.id,
    amount: Math.abs(template.amount),
    description: template.description,
    payee: template.payee,
    transaction_date: dateStr,
    transfer_group_id,
  };
  if (opts.status) sharedFields.status = opts.status;
  if (opts.recurring_template_id)
    sharedFields.recurring_template_id = opts.recurring_template_id;

  // Main leg — budget-impacting (user's real category)
  const { data: mainLeg, error: mainErr } = await supabase
    .from("transactions")
    .insert({
      ...sharedFields,
      account_id: template.account_id,
      category_id: template.category_id,
      is_income: template.is_income,
      amount: Math.abs(template.amount),
    })
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (mainErr) throw mainErr;

  // Companion leg — neutral (transfer category), flipped is_income
  const { data: companionLeg, error: compErr } = await supabase
    .from("transactions")
    .insert({
      ...sharedFields,
      account_id: template.to_account_id,
      category_id: companionCategoryId,
      is_income: !template.is_income,
    })
    .select("*, categories(id, name, color, type), accounts(id, name, type)")
    .single();
  if (compErr) throw compErr;

  return [mainLeg, companionLeg];
}

/**
 * Apply all pending recurring templates for the current user.
 * For each template, creates any transactions that are due but haven't been applied.
 * Updates last_applied on each template.
 *
 * Handles:
 *  - Regular income/expense templates → single transaction each
 *  - Transfer templates → dual-entry transaction pairs
 *  - Group parents → apply each child + auto net deposit
 *
 * @param {Date} [today] override for testability
 * @returns {Promise<{ applied: number, transactions: Array }>}
 */
export async function applyRecurringTemplates(today) {
  const templates = await getRecurringTemplates();
  const user = await getCurrentUser();
  const createdTransactions = [];

  for (const template of templates) {
    const pending = getPendingOccurrences(template, today);
    if (pending.length === 0) continue;

    if (template.is_group_parent) {
      // ── Group parent: apply each child line item as a transaction ──
      const children = template.children || [];

      for (const date of pending) {
        const dateStr = format(date, "yyyy-MM-dd");

        // Apply each child line item
        for (const child of children) {
          // Inherit payee from parent if child doesn't have one
          const childWithPayee = {
            ...child,
            payee: child.payee || template.payee,
          };
          try {
            if (childWithPayee.is_transfer && childWithPayee.to_account_id) {
              const [out, inc] = await applyAsTransfer(
                user,
                childWithPayee,
                dateStr,
              );
              createdTransactions.push(out, inc);
            } else if (
              !childWithPayee.is_transfer &&
              childWithPayee.to_account_id
            ) {
              const [main, comp] = await applyAsLinkedTransfer(
                user,
                childWithPayee,
                dateStr,
              );
              createdTransactions.push(main, comp);
            } else {
              const tx = await applyAsTransaction(
                user,
                childWithPayee,
                dateStr,
              );
              createdTransactions.push(tx);
            }
          } catch (err) {
            console.error(
              `Failed to apply group child "${childWithPayee.description}" for ${dateStr}:`,
              err,
            );
          }
        }
      }

      // Update last_applied on parent and all children
      const latestDate = format(pending[pending.length - 1], "yyyy-MM-dd");
      await supabase
        .from("recurring_templates")
        .update({ last_applied: latestDate })
        .eq("id", template.id);
      for (const child of children) {
        await supabase
          .from("recurring_templates")
          .update({ last_applied: latestDate })
          .eq("id", child.id);
      }
    } else {
      // ── Standalone template (non-group) ──
      for (const date of pending) {
        const dateStr = format(date, "yyyy-MM-dd");

        try {
          if (template.is_transfer && template.to_account_id) {
            const [out, inc] = await applyAsTransfer(user, template, dateStr);
            createdTransactions.push(out, inc);
          } else if (!template.is_transfer && template.to_account_id) {
            const [main, comp] = await applyAsLinkedTransfer(
              user,
              template,
              dateStr,
            );
            createdTransactions.push(main, comp);
          } else {
            const tx = await applyAsTransaction(user, template, dateStr);
            createdTransactions.push(tx);
          }
        } catch (err) {
          console.error(
            `Failed to apply recurring "${template.description}" for ${dateStr}:`,
            err,
          );
        }
      }

      // Update last_applied to the latest pending date
      const latestDate = pending[pending.length - 1];
      const { error: updateErr } = await supabase
        .from("recurring_templates")
        .update({ last_applied: format(latestDate, "yyyy-MM-dd") })
        .eq("id", template.id);

      if (updateErr) {
        console.error(
          `Failed to update last_applied for "${template.description}":`,
          updateErr,
        );
      }
    }
  }

  return {
    applied: createdTransactions.length,
    transactions: createdTransactions,
  };
}

// ── Projected Transaction Lifecycle ──

/**
 * Determine the status for a projected transaction based on how far out it is.
 * Within 7 days → 'pending', otherwise → 'projected'.
 * @param {Date} occurrenceDate
 * @param {Date} today
 * @returns {'projected'|'pending'}
 */
function statusForDate(occurrenceDate, today) {
  const threshold = addDays(today, 7);
  return isAfter(occurrenceDate, threshold) ? "projected" : "pending";
}

/**
 * Apply a single template (or group child) as a projected/pending transaction.
 * Re-uses the existing apply helpers but passes status and template back-link.
 * @param {Object} user
 * @param {Object} template - The template (or child)
 * @param {string} dateStr
 * @param {string} status - 'projected' or 'pending'
 * @param {string} templateId - The recurring_template_id to back-link
 * @returns {Promise<Array<Object>>} created transactions
 */
async function applyTemplateWithStatus(
  user,
  template,
  dateStr,
  status,
  templateId,
) {
  const opts = { status, recurring_template_id: templateId };
  const results = [];

  // Belt-and-suspenders dedup: check if a transaction already exists for this
  // template + date before inserting. This catches races that slip past the
  // in-memory Set in generateProjectedTransactions.
  const { data: existing, error: dupErr } = await supabase
    .from("transactions")
    .select("id")
    .eq("recurring_template_id", templateId)
    .eq("transaction_date", dateStr)
    .is("deleted_at", null)
    .limit(1);
  if (dupErr) {
    console.error(
      `Dedup check failed for "${template.description}" on ${dateStr}:`,
      dupErr,
    );
    // Fall through — still attempt the insert; the DB unique index is the final guard
  } else if (existing && existing.length > 0) {
    // Already exists — skip to prevent duplicate
    return results;
  }

  try {
    if (template.is_transfer && template.to_account_id) {
      const [out, inc] = await applyAsTransfer(user, template, dateStr, opts);
      results.push(out, inc);
    } else if (!template.is_transfer && template.to_account_id) {
      const [main, comp] = await applyAsLinkedTransfer(
        user,
        template,
        dateStr,
        opts,
      );
      results.push(main, comp);
    } else {
      const tx = await applyAsTransaction(user, template, dateStr, opts);
      results.push(tx);
    }
  } catch (err) {
    // If the DB unique index rejects the insert (code 23505), treat as a
    // harmless duplicate and swallow the error.
    if (err?.code === "23505") {
      console.info(
        `Duplicate projected tx skipped (DB constraint) for "${template.description}" on ${dateStr}`,
      );
      return results;
    }
    console.error(
      `Failed to generate projected tx for "${template.description}" on ${dateStr}:`,
      err,
    );
  }

  return results;
}

/**
 * Generate projected/pending transactions for all active recurring templates
 * within a rolling window (default: 30 days from today).
 *
 * Avoids duplicates by checking existing transactions linked to each template
 * via recurring_template_id + transaction_date.
 *
 * @param {{ windowDays?: number, today?: Date }} [options]
 * @returns {Promise<{ generated: number, transactions: Array }>}
 */
export async function generateProjectedTransactions({
  windowDays = 30,
  today: todayOverride,
} = {}) {
  // Concurrency guard: if a generation run is already in flight, wait for it
  // and return its result instead of running a second parallel pass.
  if (_generatingPromise) {
    return _generatingPromise;
  }

  const doGenerate = async () => {
    const templates = await getRecurringTemplates();
    const user = await getCurrentUser();
    const today = startOfDay(todayOverride || new Date());
    const windowEnd = addDays(today, windowDays);
    const createdTransactions = [];

    // Fetch all existing projected/pending/posted transactions for duplicate checking.
    // Include 'posted' because auto_confirm can promote pending→posted before the
    // next generation run, and we must not re-create transactions for those dates.
    const { data: existingTx, error: existErr } = await supabase
      .from("transactions")
      .select("recurring_template_id, transaction_date")
      .is("deleted_at", null)
      .in("status", ["projected", "pending", "posted"])
      .not("recurring_template_id", "is", null);
    if (existErr) throw existErr;

    // Build a Set of "templateId|date" for fast lookup
    const existingKeys = new Set(
      (existingTx || []).map(
        (tx) => `${tx.recurring_template_id}|${tx.transaction_date}`,
      ),
    );

    for (const template of templates) {
      // Get occurrences from today through windowEnd
      const occurrences = getOccurrencesInRange(template, today, windowEnd);
      if (occurrences.length === 0) continue;

      if (template.is_group_parent) {
        const children = template.children || [];

        for (const date of occurrences) {
          const dateStr = format(date, "yyyy-MM-dd");

          for (const child of children) {
            // Check for duplicate
            if (existingKeys.has(`${child.id}|${dateStr}`)) continue;

            const childWithPayee = {
              ...child,
              payee: child.payee || template.payee,
            };
            const status = statusForDate(date, today);
            const txs = await applyTemplateWithStatus(
              user,
              childWithPayee,
              dateStr,
              status,
              child.id,
            );
            createdTransactions.push(...txs);

            // Mark as seen to prevent intra-run duplicates
            existingKeys.add(`${child.id}|${dateStr}`);
          }
        }

        // Update projected_through on parent
        const latestDateStr = format(
          occurrences[occurrences.length - 1],
          "yyyy-MM-dd",
        );
        await supabase
          .from("recurring_templates")
          .update({ projected_through: latestDateStr })
          .eq("id", template.id);
      } else {
        for (const date of occurrences) {
          const dateStr = format(date, "yyyy-MM-dd");

          // Check for duplicate
          if (existingKeys.has(`${template.id}|${dateStr}`)) continue;

          const status = statusForDate(date, today);
          const txs = await applyTemplateWithStatus(
            user,
            template,
            dateStr,
            status,
            template.id,
          );
          createdTransactions.push(...txs);

          existingKeys.add(`${template.id}|${dateStr}`);
        }

        // Update projected_through
        const latestDateStr = format(
          occurrences[occurrences.length - 1],
          "yyyy-MM-dd",
        );
        await supabase
          .from("recurring_templates")
          .update({ projected_through: latestDateStr })
          .eq("id", template.id);
      }
    }

    return {
      generated: createdTransactions.length,
      transactions: createdTransactions,
    };
  }; // end doGenerate

  try {
    _generatingPromise = doGenerate();
    return await _generatingPromise;
  } finally {
    _generatingPromise = null;
  }
}

/**
 * Promote projected transactions to pending when they're within 7 days.
 * @param {Date} [todayOverride]
 * @returns {Promise<number>} Number of promoted transactions
 */
export async function promoteProjectedToPending(todayOverride) {
  const today = startOfDay(todayOverride || new Date());
  const threshold = addDays(today, 7);
  const thresholdStr = format(threshold, "yyyy-MM-dd");

  const { data, error } = await supabase
    .from("transactions")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("status", "projected")
    .is("deleted_at", null)
    .lte("transaction_date", thresholdStr)
    .select("id");

  if (error) throw error;
  return data?.length || 0;
}

/**
 * Auto-confirm pending transactions whose date has arrived,
 * but only if their source template has auto_confirm = true.
 * @param {Date} [todayOverride]
 * @returns {Promise<number>} Number of confirmed transactions
 */
export async function autoConfirmDueTransactions(todayOverride) {
  const today = startOfDay(todayOverride || new Date());
  const todayStr = format(today, "yyyy-MM-dd");

  // Find pending transactions due today or earlier
  const { data: pendingTxs, error: fetchErr } = await supabase
    .from("transactions")
    .select("id, recurring_template_id")
    .eq("status", "pending")
    .is("deleted_at", null)
    .lte("transaction_date", todayStr);
  if (fetchErr) throw fetchErr;

  if (!pendingTxs?.length) return 0;

  // Get auto_confirm status for all linked templates
  const templateIds = [
    ...new Set(
      pendingTxs
        .filter((t) => t.recurring_template_id)
        .map((t) => t.recurring_template_id),
    ),
  ];

  let autoConfirmSet = new Set();
  if (templateIds.length > 0) {
    const { data: templates, error: tplErr } = await supabase
      .from("recurring_templates")
      .select("id, auto_confirm")
      .in("id", templateIds);
    if (tplErr) throw tplErr;

    autoConfirmSet = new Set(
      (templates || []).filter((t) => t.auto_confirm).map((t) => t.id),
    );
  }

  // Determine which transactions to auto-confirm:
  // - If linked to a template with auto_confirm=true → confirm
  // - If no template link (manual pending tx) → do NOT auto-confirm
  const toConfirm = pendingTxs.filter(
    (tx) =>
      tx.recurring_template_id && autoConfirmSet.has(tx.recurring_template_id),
  );

  if (toConfirm.length === 0) return 0;

  const confirmIds = toConfirm.map((tx) => tx.id);
  const { error: updateErr } = await supabase
    .from("transactions")
    .update({ status: "posted", updated_at: new Date().toISOString() })
    .in("id", confirmIds);
  if (updateErr) throw updateErr;

  return confirmIds.length;
}

/**
 * Record a manual (on-demand) payment for a recurring template.
 * Creates one or more pending transactions for the given date,
 * with an optional amount override for standalone (non-group) templates.
 *
 * @param {Object} template - The recurring template (with children if group parent)
 * @param {string} dateStr - Transaction date in yyyy-MM-dd format
 * @param {number|null} [amountOverrideCents] - Optional signed amount override in cents
 * @returns {Promise<Array<Object>>} Created transactions
 */
export async function recordManualPayment(
  template,
  dateStr,
  amountOverrideCents = null,
) {
  const user = await getCurrentUser();
  const results = [];

  if (template.is_group_parent) {
    // Groups: apply each child at the given date (no per-item override)
    const children = template.children || [];
    for (const child of children) {
      const childWithPayee = { ...child, payee: child.payee || template.payee };
      const txs = await applyTemplateWithStatus(
        user,
        childWithPayee,
        dateStr,
        "pending",
        child.id,
      );
      results.push(...txs);
    }
  } else {
    // Standalone: optionally override amount, preserving sign convention
    const effectiveTemplate =
      amountOverrideCents !== null
        ? {
            ...template,
            amount: template.is_income
              ? Math.abs(amountOverrideCents)
              : -Math.abs(amountOverrideCents),
          }
        : template;

    const txs = await applyTemplateWithStatus(
      user,
      effectiveTemplate,
      dateStr,
      "pending",
      template.id,
    );
    results.push(...txs);
  }

  return results;
}

/**
 * Run the full recurring lifecycle on app startup:
 * 1. Generate new projected/pending transactions for the rolling window
 * 2. Promote projected → pending for items within 7 days
 * 3. Auto-confirm due pending items (where template.auto_confirm = true)
 *
 * @param {{ windowDays?: number }} [options]
 * @returns {Promise<{ generated: number, promoted: number, confirmed: number }>}
 */
export async function initializeRecurringCycle({ windowDays = 30 } = {}) {
  const result = { generated: 0, promoted: 0, confirmed: 0 };

  try {
    const genResult = await generateProjectedTransactions({ windowDays });
    result.generated = genResult.generated;
  } catch (err) {
    console.error("Failed to generate projected transactions:", err);
  }

  try {
    result.promoted = await promoteProjectedToPending();
  } catch (err) {
    console.error("Failed to promote projected → pending:", err);
  }

  try {
    result.confirmed = await autoConfirmDueTransactions();
  } catch (err) {
    console.error("Failed to auto-confirm due transactions:", err);
  }

  return result;
}
