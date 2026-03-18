import { supabase, getCurrentUser } from "./supabase";
import { normalizeDate, normalizeAmount } from "../utils/csvParser";

/**
 * Validate and transform raw mapped rows into transaction-ready objects.
 *
 * Rows may come in two formats:
 *   - Classic: { date, amount, description } — amount is a raw string
 *   - Pre-resolved (split mode): { date, amount (cents), isExpense, description, _amountPreResolved: true }
 *
 * @param {object[]} rows - Array of mapped row objects
 * @param {object[]} categories - User's categories from DB
 * @param {object} categoryAssignments - { rowIndex: categoryId } manual overrides
 * @param {object} accountAssignments - { csvAccountName: accountId } mapping
 * @returns {{ valid: object[], errors: object[] }}
 *   valid: Array of { amount, description, transaction_date, category_id, account_id, is_income, _rowIndex }
 *   errors: Array of { rowIndex, field, message }
 */
const MAX_IMPORT_ROWS = 5_000;

export function validateAndTransform(
  rows,
  categories,
  categoryAssignments = {},
  accountAssignments = {},
) {
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      valid: [],
      errors: [
        {
          rowIndex: -1,
          field: "file",
          message: `Import exceeds the ${MAX_IMPORT_ROWS.toLocaleString()}-row limit. Split the file into smaller batches and import each separately.`,
        },
      ],
    };
  }

  const valid = [];
  const errors = [];

  rows.forEach((row, idx) => {
    const rowErrors = [];

    // ── Date ──
    const { date, error: dateError } = normalizeDate(row.date);
    if (dateError) {
      rowErrors.push({ rowIndex: idx, field: "date", message: dateError });
    }

    // ── Amount ──
    let cents;
    let isExpense;

    if (row._amountPreResolved) {
      // Amount already resolved to cents by ColumnMapper (split payments/deposits mode)
      cents = row.amount;
      isExpense = row.isExpense;
      if (cents === null || cents === undefined) {
        rowErrors.push({
          rowIndex: idx,
          field: "amount",
          message: "Empty amount",
        });
      } else if (cents === 0) {
        rowErrors.push({
          rowIndex: idx,
          field: "amount",
          message: "Amount must be greater than $0.00",
        });
      }
    } else {
      const norm = normalizeAmount(row.amount);
      if (norm.error) {
        rowErrors.push({ rowIndex: idx, field: "amount", message: norm.error });
      } else if (norm.cents === 0) {
        rowErrors.push({
          rowIndex: idx,
          field: "amount",
          message: "Amount must be greater than $0.00",
        });
      }
      cents = norm.cents;
      isExpense = norm.isNegative;
    }

    // ── Description ──
    const description = String(row.description || "").trim();

    // ── Payee ──
    const payee = String(row.payee || "").trim();

    // ── Account ──
    const csvAccount = String(row.csvAccount || "").trim();
    const accountId = csvAccount
      ? accountAssignments[csvAccount] || null
      : null;
    if (!accountId && csvAccount) {
      rowErrors.push({
        rowIndex: idx,
        field: "account",
        message: `No account matched for "${csvAccount}"`,
      });
    } else if (!accountId && !csvAccount) {
      // If no CSV account column was mapped, accountAssignments may have a
      // special __default key for a pre-selected default account.
      // This check is handled below after rowErrors.
    }

    // ── Category ──
    // Priority: manual override → CSV category name match → description auto-match
    let categoryId = categoryAssignments[idx];
    if (!categoryId) {
      const csvCat = String(row.csvCategory || "").trim();
      if (csvCat) {
        const matched = categories.find(
          (c) => c.name.toLowerCase() === csvCat.toLowerCase(),
        );
        if (matched) categoryId = matched.id;
      }
    }
    if (!categoryId) {
      categoryId = autoMatchCategory(description, categories, {
        payee,
        csvCategory: String(row.csvCategory || "").trim(),
      });
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      return;
    }

    // Determine income/expense from the raw CSV sign (deposit = income, withdrawal = expense).
    // Category type is used for budget classification only and does NOT override the CSV direction.
    // Exception: an explicit 'income' category marks the transaction as income regardless of sign
    // (handles edge cases like salary CSVs that record income as negative amounts).
    // However, when the direction was explicitly determined from split payment/deposit columns
    // (_fromSplitColumns), it is authoritative and must not be overridden — a payment going out
    // of a "reimbursement / refund" category should remain an expense, not be flipped to income.
    let isIncome = !isExpense;
    if (categoryId && !row._fromSplitColumns) {
      const cat = categories.find((c) => c.id === categoryId);
      if (cat && cat.type === "income") {
        isIncome = true;
      }
      // For all other category types (needs/wants/savings/transfer), preserve
      // the original CSV direction so deposits to expense categories (e.g. refunds)
      // remain deposits.
    }

    valid.push({
      amount: cents,
      description,
      payee,
      transaction_date: date,
      category_id: categoryId || null,
      account_id: accountId || accountAssignments["__default"] || null,
      is_income: isIncome,
      _rowIndex: idx,
    });
  });

  return { valid, errors };
}

/**
 * Auto-match a transaction to a category by fuzzy keyword matching.
 * Searches the description, payee, and csvCategory fields for matches.
 * Returns the best-matching category ID, or null.
 *
 * @param {string} description
 * @param {object[]} categories - Array of { id, name, type }
 * @param {{ payee?: string, csvCategory?: string }} extras - Additional fields to match against
 * @returns {string|null} category ID or null
 */
export function autoMatchCategory(
  description,
  categories,
  { payee = "", csvCategory = "" } = {},
) {
  if (!categories?.length) return null;

  // Combine all searchable text fields
  const desc = (description || "").toLowerCase();
  const payeeLower = (payee || "").toLowerCase().trim();
  const csvCatLower = (csvCategory || "").toLowerCase().trim();

  // Keyword → category name mapping for common patterns.
  //
  // Multi-word / more-specific keywords are listed first so they match
  // before shorter, ambiguous single-word keywords (e.g. "credit card
  // payment" matches the transfer category before "credit" could match
  // something else).
  const keywordMap = {
    // ── Transfer / non-budgeting categories ──
    "account transfer": "account transfer",
    "bank transfer": "account transfer",
    "wire transfer": "account transfer",
    transfer: "account transfer",
    xfer: "account transfer",
    "credit card payment": "credit card payment",
    "card payment": "credit card payment",
    "cc payment": "credit card payment",
    "payment - thank you": "credit card payment",
    "investment contribution": "investment contribution",
    "ira contribution": "investment contribution",
    "401k contribution": "investment contribution",
    "roth contribution": "investment contribution",
    reimbursement: "reimbursement / refund",
    refund: "reimbursement / refund",
    cashback: "reimbursement / refund",
    "cash back": "reimbursement / refund",
    rebate: "reimbursement / refund",
    chargeback: "reimbursement / refund",

    // ── Needs ──
    grocery: "groceries",
    groceries: "groceries",
    walmart: "groceries",
    costco: "groceries",
    kroger: "groceries",
    "whole foods": "groceries",
    safeway: "groceries",
    aldi: "groceries",
    trader: "groceries",
    rent: "rent/mortgage",
    mortgage: "rent/mortgage",
    lease: "rent/mortgage",
    electric: "utilities",
    water: "utilities",
    gas: "utilities",
    internet: "utilities",
    phone: "utilities",
    utility: "utilities",
    utilities: "utilities",
    uber: "transportation",
    lyft: "transportation",
    transit: "transportation",
    parking: "transportation",
    fuel: "transportation",
    gasoline: "transportation",

    // ── Wants ──
    netflix: "entertainment",
    spotify: "entertainment",
    hulu: "entertainment",
    disney: "entertainment",
    movie: "entertainment",
    game: "entertainment",
    restaurant: "dining out",
    dining: "dining out",
    doordash: "dining out",
    grubhub: "dining out",
    "uber eats": "dining out",
    mcdonald: "dining out",
    starbucks: "dining out",
    coffee: "dining out",

    // ── Savings ──
    invest: "investments",
    stock: "investments",
    dividend: "investments",
    "401k": "investments",
    brokerage: "investments",
    savings: "emergency fund",
    "emergency fund": "emergency fund",

    // ── Income ──
    salary: "income",
    payroll: "income",
    deposit: "income",
    paycheck: "income",
    wage: "income",
  };

  // Build array of all text fields to search (in priority order)
  const searchTexts = [desc, payeeLower, csvCatLower].filter(Boolean);

  if (searchTexts.length === 0) return null;

  // Try keyword matching first — check all text fields
  for (const [keyword, catName] of Object.entries(keywordMap)) {
    for (const text of searchTexts) {
      if (text.includes(keyword)) {
        const match = categories.find(
          (c) => c.name.toLowerCase() === catName.toLowerCase(),
        );
        if (match) return match.id;
      }
    }
  }

  // Fallback: try matching words from all text fields to category names
  const allText = searchTexts.join(" ");
  const words = allText.split(/\s+/);
  for (const cat of categories) {
    const catLower = cat.name.toLowerCase();
    if (allText.includes(catLower)) return cat.id;
    if (words.some((w) => w.length > 3 && catLower.includes(w))) return cat.id;
  }

  return null;
}

/**
 * Detect potential transfer pairs among validated rows.
 * Pairs rows that have: same transaction_date, opposite amounts (one positive,
 * one negative with same absolute value), and matching payee or description
 * (case-insensitive). One row in the pair should have a transfer-type category
 * and the other should not, forming a "linked transfer" pair.
 *
 * Also detects regular transfer pairs (both have transfer categories).
 *
 * Each row can only be in one pair (first match wins).
 *
 * @param {object[]} validRows - Array of validated transaction objects
 * @param {object[]} categories - User's categories from DB
 * @returns {Map<number, number>} Map of rowIndex → pairedRowIndex (bidirectional)
 */
export function detectTransferPairs(validRows, categories) {
  const pairs = new Map();
  const used = new Set();

  // Build a category type lookup
  const catTypeMap = new Map();
  for (const cat of categories) {
    catTypeMap.set(cat.id, cat.type);
  }

  for (let i = 0; i < validRows.length; i++) {
    if (used.has(i)) continue;
    const rowA = validRows[i];

    for (let j = i + 1; j < validRows.length; j++) {
      if (used.has(j)) continue;
      const rowB = validRows[j];

      // Same date
      if (rowA.transaction_date !== rowB.transaction_date) continue;

      // Opposite amounts (same absolute value)
      if (Math.abs(rowA.amount) !== Math.abs(rowB.amount)) continue;
      if (rowA.amount === rowB.amount) continue; // Same sign, skip

      // Matching payee or description (case-insensitive)
      const payeeMatch =
        rowA.payee &&
        rowB.payee &&
        rowA.payee.toLowerCase().trim() === rowB.payee.toLowerCase().trim();
      const descMatch =
        rowA.description &&
        rowB.description &&
        rowA.description.toLowerCase().trim() ===
          rowB.description.toLowerCase().trim();
      if (!payeeMatch && !descMatch) continue;

      // Check category types
      const typeA = catTypeMap.get(rowA.category_id);
      const typeB = catTypeMap.get(rowB.category_id);

      // Valid pairs: one transfer + one non-transfer (linked), or both transfer (regular)
      const isLinkedPair = (typeA === "transfer") !== (typeB === "transfer");
      const isRegularTransferPair =
        typeA === "transfer" && typeB === "transfer";

      if (isLinkedPair || isRegularTransferPair) {
        pairs.set(i, j);
        pairs.set(j, i);
        used.add(i);
        used.add(j);
        break;
      }
    }
  }

  return pairs;
}

/**
 * Check for potential duplicate transactions (same date + similar amount).
 *
 * @param {object[]} transactions - Transactions to check
 * @param {{ month?: number, year?: number }} dateRange - Optional range filter
 * @returns {Promise<object[]>} Array of { rowIndex, existingTransaction } for possible dupes
 */
export async function checkDuplicates(transactions) {
  if (!transactions.length) return [];

  // Get date range from the transactions to narrow the DB query
  const dates = transactions.map((t) => t.transaction_date).filter(Boolean);
  if (!dates.length) return [];
  const minDate = dates.sort()[0];
  const maxDate = dates.sort().reverse()[0];

  // Paginate to avoid Supabase's 1000-row default limit.
  const PAGE_SIZE = 1000;
  let existing = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("transactions")
      .select("id, amount, transaction_date, description")
      .is("deleted_at", null)
      .gte("transaction_date", minDate)
      .lte("transaction_date", maxDate)
      .range(from, from + PAGE_SIZE - 1);
    if (error) return [];
    existing = existing.concat(data);
    if (data.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      from += PAGE_SIZE;
    }
  }

  if (!existing.length) return [];

  const duplicates = [];
  transactions.forEach((tx) => {
    const match = existing.find(
      (e) =>
        e.transaction_date === tx.transaction_date && e.amount === tx.amount,
    );
    if (match) {
      duplicates.push({
        rowIndex: tx._rowIndex,
        existingTransaction: match,
      });
    }
  });

  return duplicates;
}

/**
 * Bulk insert validated transactions into Supabase.
 * Supports transfer pairing: if transferPairs Map is provided, paired rows
 * share a transfer_group_id.
 *
 * @param {object[]} transactions - Array of validated transaction objects
 * @param {Map<number, number>} [transferPairs] - Optional map of _rowIndex → paired _rowIndex
 * @returns {Promise<{ inserted: number, failed: number, errors: string[] }>}
 */
export async function bulkInsertTransactions(
  transactions,
  transferPairs = new Map(),
) {
  if (!transactions.length) {
    return { inserted: 0, failed: 0, errors: ["No transactions to import."] };
  }

  const user = await getCurrentUser();

  // Pre-generate transfer_group_ids for paired rows
  const groupIdMap = new Map(); // _rowIndex → transfer_group_id
  const processedPairs = new Set();
  for (const [rowIdx, pairedIdx] of transferPairs.entries()) {
    const pairKey =
      Math.min(rowIdx, pairedIdx) + ":" + Math.max(rowIdx, pairedIdx);
    if (processedPairs.has(pairKey)) continue;
    processedPairs.add(pairKey);
    const groupId = crypto.randomUUID();
    groupIdMap.set(rowIdx, groupId);
    groupIdMap.set(pairedIdx, groupId);
  }

  // Prepare rows for insert (strip internal fields, add transfer_group_id)
  const rows = transactions.map((tx) => ({
    user_id: user.id,
    account_id: tx.account_id,
    category_id: tx.category_id,
    amount: tx.amount,
    description: tx.description,
    payee: tx.payee || null,
    transaction_date: tx.transaction_date,
    is_income: tx.is_income,
    transfer_group_id: groupIdMap.get(tx._rowIndex) || null,
  }));

  // Supabase supports bulk insert; insert in batches of 100 to avoid limits
  const BATCH_SIZE = 100;
  let inserted = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { data, error } = await supabase
      .from("transactions")
      .insert(batch)
      .select("id");

    if (error) {
      failed += batch.length;
      errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
    } else {
      inserted += data.length;
    }
  }

  return { inserted, failed, errors };
}

/**
 * Generate a downloadable import report as CSV.
 *
 * @param {{ inserted: number, failed: number, errors: string[], validRows: object[], invalidRows: object[] }} report
 * @returns {string} CSV-formatted report text
 */
export function generateImportReport({
  inserted,
  failed,
  errors,
  validRows = [],
  invalidRows = [],
}) {
  const lines = [
    "Import Report",
    `Date: ${new Date().toLocaleDateString()}`,
    `Successfully imported: ${inserted}`,
    `Failed: ${failed}`,
    "",
  ];

  if (errors.length) {
    lines.push("--- Errors ---");
    errors.forEach((e) => lines.push(e));
    lines.push("");
  }

  if (invalidRows.length) {
    lines.push("--- Invalid Rows ---");
    lines.push("Row,Field,Error");
    invalidRows.forEach((e) => {
      lines.push(`${e.rowIndex + 2},"${e.field}","${e.message}"`);
    });
    lines.push("");
  }

  if (validRows.length) {
    lines.push("--- Imported Transactions ---");
    lines.push("Date,Amount (cents),Description,Category ID,Is Income");
    validRows.forEach((tx) => {
      lines.push(
        `${tx.transaction_date},${tx.amount},"${tx.description}",${tx.category_id || "None"},${tx.is_income}`,
      );
    });
  }

  return lines.join("\n");
}

/**
 * Trigger a file download in the browser.
 *
 * @param {string} content - File content
 * @param {string} filename - Download filename
 * @param {string} mimeType - MIME type
 */
export function downloadFile(content, filename, mimeType = "text/csv") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
