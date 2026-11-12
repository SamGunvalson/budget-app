import { supabase, getCurrentUser } from "./supabase";
import {
  isIncomeDebit,
  isSettledTransaction,
  isSpendingCredit,
} from "../utils/helpers";

// Phase 5: code-split the exceljs bundle (~1 MB).  We only need it when the
// user actually clicks an export button, so defer the import until first use
// and cache the resolved module across subsequent exports.
let _excelJsPromise = null;
function loadExcelJs() {
  if (!_excelJsPromise) {
    _excelJsPromise = import("exceljs").then((m) => m.default || m);
  }
  return _excelJsPromise;
}

// ── Helpers ──

/**
 * Sanitize a cell value to neutralize CSV formula injection (CWE-1236).
 *
 * Spreadsheet apps (Excel, Numbers, Sheets) interpret cells starting with
 * `=`, `+`, `-`, `@`, tab, or carriage-return as formulas. A malicious
 * description like `=HYPERLINK(...)` ingested via import would re-execute on
 * export. Prefixing with a single quote (`'`) forces the value to be treated
 * as plain text.
 *
 * Only operates on strings — numbers, dates, booleans pass through unchanged.
 */
function sanitizeCell(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  const first = value.charCodeAt(0);
  // = + - @ \t \r
  if (
    first === 0x3d ||
    first === 0x2b ||
    first === 0x2d ||
    first === 0x40 ||
    first === 0x09 ||
    first === 0x0d
  ) {
    return "'" + value;
  }
  return value;
}

/**
 * Format cents to dollars string (e.g. 15099 → "150.99").
 */
function centsToDollars(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * Build a date stamp for file names (YYYY-MM-DD).
 */
function datestamp() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Trigger a browser download for a Blob.
 */
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Data fetchers (bypass service layer for full export) ──
// The category, account and template fetchers deliberately include inactive
// (archived/closed/deleted) rows: exported transactions still reference them.

async function fetchAllTransactions() {
  const user = await getCurrentUser();
  const PAGE_SIZE = 1000;
  let all = [];
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("transactions")
      .select("*, categories(id, name, type), accounts(id, name, type)")
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .order("transaction_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    all = all.concat(data);
    hasMore = data.length === PAGE_SIZE;
    from += PAGE_SIZE;
  }
  return all;
}

async function fetchAllBudgetPlans() {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from("budget_plans")
    .select("*")
    .eq("user_id", user.id)
    .order("year", { ascending: true })
    .order("month", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchBudgetItemsForPlan(planId) {
  const { data, error } = await supabase
    .from("budget_items")
    .select("*, categories(id, name, type)")
    .eq("budget_plan_id", planId);
  if (error) throw error;
  return data || [];
}

async function fetchAllCategories() {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", user.id)
    .order("type")
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return data || [];
}

async function fetchAllAccounts() {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from("accounts")
    .select("*")
    .eq("user_id", user.id)
    .order("type")
    .order("name");
  if (error) throw error;
  return data || [];
}

async function fetchAllRecurringTemplates() {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from("recurring_templates")
    .select(
      "*, categories(id, name, type), accounts(id, name, type), to_account:accounts!to_account_id(id, name, type)",
    )
    .eq("user_id", user.id)
    .order("description");
  if (error) throw error;
  return data || [];
}

async function fetchAllUserPreferences() {
  const user = await getCurrentUser();
  const { data, error } = await supabase
    .from("user_preferences")
    .select("*")
    .eq("user_id", user.id);
  if (error) throw error;
  return data || [];
}

// Partnerships and split expenses are scoped by RLS to the ones the current
// user belongs to (there is no user_id column to filter on).
async function fetchAllPartnerships() {
  const { data, error } = await supabase
    .from("partnerships")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function fetchAllSplitExpenses() {
  const { data, error } = await supabase
    .from("split_expenses")
    .select("*")
    .is("deleted_at", null)
    .order("expense_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

// ── Export: Transactions CSV ──

/**
 * Export all transactions as a CSV file using ExcelJS.
 * Columns: Date, Description, Payee, Category, CategoryType, Type, Account, Amount, Status
 */
export async function exportTransactionsCSV() {
  const ExcelJS = await loadExcelJs();
  const transactions = await fetchAllTransactions();

  const rows = transactions.map((t) => {
    const categoryType = t.categories?.type || "";
    let type = "Expense";
    if (categoryType === "transfer") type = "Transfer";
    else if (isSpendingCredit(t)) type = "Refund";
    else if (isIncomeDebit(t)) type = "Income Deduction";
    else if (t.is_income) type = "Income";

    return {
      Date: t.transaction_date,
      Description: t.description || "",
      Payee: t.payee || "",
      Category: t.categories?.name || "Uncategorized",
      CategoryType: categoryType,
      Type: type,
      Account: t.accounts?.name || "",
      Amount: centsToDollars(t.amount),
      Status: t.status || "posted",
    };
  });

  // Create workbook and worksheet
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Transactions");

  // Add headers
  const headers = [
    "Date",
    "Description",
    "Payee",
    "Category",
    "CategoryType",
    "Type",
    "Account",
    "Amount",
    "Status",
  ];
  worksheet.addRow(headers);

  // Add data rows (sanitized against CSV formula injection)
  rows.forEach((row) => {
    worksheet.addRow([
      sanitizeCell(row.Date),
      sanitizeCell(row.Description),
      sanitizeCell(row.Payee),
      sanitizeCell(row.Category),
      sanitizeCell(row.CategoryType),
      sanitizeCell(row.Type),
      sanitizeCell(row.Account),
      sanitizeCell(row.Amount),
      sanitizeCell(row.Status),
    ]);
  });

  // Set column widths
  worksheet.columns = [
    { width: 12 }, // Date
    { width: 30 }, // Description
    { width: 20 }, // Payee
    { width: 18 }, // Category
    { width: 12 }, // CategoryType
    { width: 10 }, // Type
    { width: 20 }, // Account
    { width: 12 }, // Amount
    { width: 10 }, // Status
  ];

  const csvContent = await workbook.csv.writeBuffer();
  // Add BOM for Excel UTF-8 detection
  const bom = "\uFEFF";
  const csvString = csvContent.toString();
  const blob = new Blob([bom + csvString], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `transactions-${datestamp()}.csv`);

  return rows.length;
}

// ── Export: Budget History CSV ──

/**
 * Export monthly budget plans with planned vs actual amounts per category.
 * Columns: Month, Year, Category, Planned, Actual
 */
export async function exportBudgetCSV() {
  const ExcelJS = await loadExcelJs();
  const plans = await fetchAllBudgetPlans();
  const transactions = await fetchAllTransactions();
  const today = datestamp();

  const rows = [];

  for (const plan of plans) {
    const items = await fetchBudgetItemsForPlan(plan.id);

    // Calculate actuals for this month/year
    const startDate = `${plan.year}-${String(plan.month).padStart(2, "0")}-01`;
    const endMonth = plan.month === 12 ? 1 : plan.month + 1;
    const endYear = plan.month === 12 ? plan.year + 1 : plan.year;
    const endDate = `${endYear}-${String(endMonth).padStart(2, "0")}-01`;

    // Only settled rows count as actuals: posted and not dated in the future
    // (projected/pending recurring rows are plans, not actuals).
    const monthTxns = transactions.filter(
      (t) =>
        t.transaction_date >= startDate &&
        t.transaction_date < endDate &&
        isSettledTransaction(t, today),
    );

    // Aggregate actuals by category (exclude transfers per DATA_MODEL).
    // Refunds in a spending category and debits in an income category reduce
    // that category's actual instead of adding to it.
    const actualsByCat = {};
    for (const t of monthTxns) {
      const catId = t.category_id;
      if (!catId) continue;
      if (t.categories?.type === "transfer") continue;
      if (!actualsByCat[catId]) actualsByCat[catId] = 0;
      const amount = Math.abs(t.amount);
      actualsByCat[catId] +=
        isSpendingCredit(t) || isIncomeDebit(t) ? -amount : amount;
    }

    // Add income row for the plan
    const monthName = new Date(plan.year, plan.month - 1).toLocaleString(
      "default",
      { month: "long" },
    );

    rows.push({
      Month: monthName,
      Year: plan.year,
      Category: "(Total Income)",
      Planned: centsToDollars(plan.total_income || 0),
      Actual: "",
    });

    // Add each budget item
    for (const item of items) {
      rows.push({
        Month: monthName,
        Year: plan.year,
        Category: item.categories?.name || "Unknown",
        Planned: centsToDollars(item.planned_amount || 0),
        Actual: centsToDollars(actualsByCat[item.category_id] || 0),
      });
    }
  }

  if (rows.length === 0) {
    // No budget plans yet — create a placeholder
    rows.push({
      Month: "",
      Year: "",
      Category: "No budget plans found",
      Planned: "",
      Actual: "",
    });
  }

  // Create workbook and worksheet
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Budget History");

  // Add headers
  const headers = ["Month", "Year", "Category", "Planned", "Actual"];
  worksheet.addRow(headers);

  // Add data rows
  rows.forEach((row) => {
    worksheet.addRow([
      sanitizeCell(row.Month),
      sanitizeCell(row.Year),
      sanitizeCell(row.Category),
      sanitizeCell(row.Planned),
      sanitizeCell(row.Actual),
    ]);
  });

  // Set column widths
  worksheet.columns = [
    { width: 12 }, // Month
    { width: 8 }, // Year
    { width: 22 }, // Category
    { width: 12 }, // Planned
    { width: 12 }, // Actual
  ];

  const csvContent = await workbook.csv.writeBuffer();
  const bom = "\uFEFF";
  const csvString = csvContent.toString();
  const blob = new Blob([bom + csvString], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `budget-history-${datestamp()}.csv`);

  return rows.length;
}

// ── Export: Full JSON Backup ──

/**
 * Export all user data as a human-readable JSON backup.
 * Includes: categories, accounts and recurring_templates (inactive ones too,
 * so ids on exported transactions resolve), live transactions, budget_plans +
 * items, user_preferences, partnerships and live split_expenses.
 */
export async function exportFullBackupJSON() {
  const [
    categories,
    accounts,
    transactions,
    plans,
    recurring,
    userPreferences,
    partnerships,
    splitExpenses,
  ] = await Promise.all([
    fetchAllCategories(),
    fetchAllAccounts(),
    fetchAllTransactions(),
    fetchAllBudgetPlans(),
    fetchAllRecurringTemplates(),
    fetchAllUserPreferences(),
    fetchAllPartnerships(),
    fetchAllSplitExpenses(),
  ]);

  // Fetch budget items for all plans in parallel
  const planItems = await Promise.all(
    plans.map(async (plan) => ({
      ...plan,
      items: await fetchBudgetItemsForPlan(plan.id),
    })),
  );

  const backup = {
    exportDate: new Date().toISOString(),
    version: "1.2",
    data: {
      categories,
      accounts,
      transactions,
      budget_plans: planItems,
      recurring_templates: recurring,
      user_preferences: userPreferences,
      partnerships,
      split_expenses: splitExpenses,
    },
  };

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  downloadBlob(blob, `budget-backup-${datestamp()}.json`);

  return {
    categories: categories.length,
    accounts: accounts.length,
    transactions: transactions.length,
    budgetPlans: plans.length,
    recurringTemplates: recurring.length,
    userPreferences: userPreferences.length,
    partnerships: partnerships.length,
    splitExpenses: splitExpenses.length,
  };
}
