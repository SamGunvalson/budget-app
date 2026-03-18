import ExcelJS from "exceljs";

/**
 * Parse a CSV or Excel file into an array of row objects.
 * Uses ExcelJS to handle both .csv and .xlsx/.xls formats.
 *
 * @param {File} file - Browser File object
 * @returns {Promise<{ headers: string[], rows: object[], error: string|null }>}
 *   headers: column header strings
 *   rows: array of { [header]: cellValue } objects
 *   error: null on success, message string on failure
 */
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

export async function parseSpreadsheetFile(file) {
  try {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      return {
        headers: [],
        rows: [],
        error: "File is too large. Maximum allowed size is 10 MB.",
      };
    }
    const arrayBuffer = await file.arrayBuffer();
    const workbook = new ExcelJS.Workbook();

    // Read the file based on extension
    if (file.name.toLowerCase().endsWith(".csv")) {
      await workbook.csv.read(arrayBuffer);
    } else {
      await workbook.xlsx.load(arrayBuffer);
    }

    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      return { headers: [], rows: [], error: "The file contains no sheets." };
    }

    // Convert to array-of-arrays for processing
    const aoa = [];
    worksheet.eachRow((row) => {
      const rowValues = [];
      row.eachCell((cell, colNumber) => {
        // Handle different cell types
        let value = cell.value;
        if (cell.type === ExcelJS.ValueType.Date) {
          value = new Date(value);
        } else if (
          typeof value === "object" &&
          value !== null &&
          value.result
        ) {
          // Handle formulas
          value = value.result;
        }
        rowValues[colNumber - 1] = value || "";
      });
      aoa.push(rowValues);
    });

    if (aoa.length < 2) {
      return {
        headers: [],
        rows: [],
        error: "File must have a header row and at least one data row.",
      };
    }

    const headers = aoa[0].map((h) => String(h).trim());

    // Build row objects keyed by header
    const rows = [];
    for (let i = 1; i < aoa.length; i++) {
      const cells = aoa[i];
      // Skip completely empty rows
      if (cells.every((c) => c === "" || c === null || c === undefined))
        continue;

      const row = {};
      headers.forEach((header, idx) => {
        row[header] = cells[idx] !== undefined ? cells[idx] : "";
      });
      rows.push(row);
    }

    if (rows.length === 0) {
      return { headers, rows: [], error: "No data rows found in the file." };
    }

    return { headers, rows, error: null };
  } catch (err) {
    return {
      headers: [],
      rows: [],
      error: `Failed to parse file: ${err.message || "Unknown error"}`,
    };
  }
}

// ── Column-type guessing heuristics ──

const DATE_KEYWORDS = [
  "date",
  "time",
  "when",
  "posted",
  "trans date",
  "transaction date",
];
const AMOUNT_KEYWORDS = [
  "amount",
  "total",
  "sum",
  "price",
  "cost",
  "debit",
  "credit",
  "value",
];
const PAYMENT_KEYWORDS = [
  "payment",
  "payments",
  "debit",
  "debits",
  "withdrawal",
  "withdrawals",
  "expense",
  "expenses",
  "out",
];
const DEPOSIT_KEYWORDS = [
  "deposit",
  "deposits",
  "credit",
  "credits",
  "income",
  "in",
];
const DESC_KEYWORDS = [
  "description",
  "desc",
  "memo",
  "note",
  "details",
  "narrative",
];
const PAYEE_KEYWORDS = ["payee", "vendor", "merchant", "recipient"];
const CATEGORY_KEYWORDS = ["category", "tag", "label"];
const ACCOUNT_KEYWORDS = ["account", "account name", "bank", "source"];

/**
 * Auto-detect which column headers map to date, amount, and description.
 * Also detects split payment/deposit columns.
 *
 * Returns a mapping suggestion:
 *   { date, amount, description, payments, deposits, splitMode }
 *   - splitMode: true if separate payments & deposits columns detected
 *   - amount: used when splitMode is false
 *   - payments/deposits: used when splitMode is true
 *
 * @param {string[]} headers
 * @returns {{ date: string|null, amount: string|null, description: string|null, payments: string|null, deposits: string|null, splitMode: boolean }}
 */
export function guessColumnMapping(headers) {
  const mapping = {
    date: null,
    amount: null,
    description: null,
    payments: null,
    deposits: null,
    payee: null,
    csvCategory: null,
    csvAccount: null,
    splitMode: false,
  };
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());

  for (let i = 0; i < lowerHeaders.length; i++) {
    const h = lowerHeaders[i];
    if (!mapping.date && DATE_KEYWORDS.some((kw) => h.includes(kw))) {
      mapping.date = headers[i];
    }
    if (!mapping.amount && AMOUNT_KEYWORDS.some((kw) => h.includes(kw))) {
      mapping.amount = headers[i];
    }
    if (!mapping.payments && PAYMENT_KEYWORDS.some((kw) => h.includes(kw))) {
      mapping.payments = headers[i];
    }
    if (!mapping.deposits && DEPOSIT_KEYWORDS.some((kw) => h.includes(kw))) {
      mapping.deposits = headers[i];
    }
    if (!mapping.description && DESC_KEYWORDS.some((kw) => h.includes(kw))) {
      mapping.description = headers[i];
    }
    if (!mapping.payee && PAYEE_KEYWORDS.some((kw) => h.includes(kw))) {
      mapping.payee = headers[i];
    }
    if (
      !mapping.csvCategory &&
      CATEGORY_KEYWORDS.some((kw) => h.includes(kw))
    ) {
      mapping.csvCategory = headers[i];
    }
    if (!mapping.csvAccount && ACCOUNT_KEYWORDS.some((kw) => h.includes(kw))) {
      mapping.csvAccount = headers[i];
    }
  }

  // If we found both payments and deposits columns, prefer split mode
  if (mapping.payments && mapping.deposits) {
    mapping.splitMode = true;
  }

  return mapping;
}

/**
 * Normalize a date value from a spreadsheet cell into YYYY-MM-DD format.
 * Handles Date objects (from SheetJS cellDates), and common string formats:
 *   MM/DD/YYYY, MM-DD-YYYY, YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY (if flagged), etc.
 *
 * @param {*} value - Raw cell value
 * @returns {{ date: string|null, error: string|null }}
 */
export function normalizeDate(value) {
  if (!value && value !== 0) {
    return { date: null, error: "Empty date" };
  }

  // If SheetJS already parsed it as a Date object
  if (value instanceof Date) {
    if (isNaN(value.getTime()))
      return { date: null, error: "Invalid date object" };
    return { date: formatISODate(value), error: null };
  }

  const str = String(value).trim();
  if (!str) return { date: null, error: "Empty date" };

  // Try ISO format first: YYYY-MM-DD or YYYY/MM/DD
  // Format directly from capture groups to avoid Date constructor timezone issues
  const isoMatch = str.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    const y = +isoMatch[1],
      m = +isoMatch[2],
      d = +isoMatch[3];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return {
        date: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        error: null,
      };
    }
  }

  // Try US format: MM/DD/YYYY or MM-DD-YYYY
  // Format directly from capture groups to avoid Date constructor timezone issues
  const usMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (usMatch) {
    let year = +usMatch[3];
    if (year < 100) year += 2000;
    const m = +usMatch[1],
      d = +usMatch[2];
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return {
        date: `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
        error: null,
      };
    }
  }

  // Try Date.parse as last resort
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime()))
    return { date: formatISODate(parsed), error: null };

  return { date: null, error: `Cannot parse date: "${str}"` };
}

/**
 * Normalize an amount value from a spreadsheet cell into cents (integer).
 * Handles: "$1,234.56", "(100.50)", "-50", "1234", etc.
 *
 * @param {*} value
 * @returns {{ cents: number|null, isNegative: boolean, error: string|null }}
 */
export function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") {
    return { cents: null, isNegative: false, error: "Empty amount" };
  }

  // If already a number
  if (typeof value === "number") {
    const cents = Math.round(Math.abs(value) * 100);
    return { cents, isNegative: value < 0, error: null };
  }

  let str = String(value).trim();
  if (!str) return { cents: null, isNegative: false, error: "Empty amount" };

  // Check for parenthetical negatives: (123.45)
  let isNegative = false;
  if (str.startsWith("(") && str.endsWith(")")) {
    isNegative = true;
    str = str.slice(1, -1);
  } else if (str.startsWith("-")) {
    isNegative = true;
    str = str.slice(1);
  }

  // Strip currency symbols, commas, whitespace
  str = str.replace(/[$€£¥,\s]/g, "");

  const num = parseFloat(str);
  if (isNaN(num)) {
    return {
      cents: null,
      isNegative: false,
      error: `Not a valid number: "${value}"`,
    };
  }

  const cents = Math.round(num * 100);
  if (cents > 99_999_999) {
    return {
      cents: null,
      isNegative: false,
      error: `Amount exceeds maximum allowed value ($999,999.99): "${value}"`,
    };
  }

  return { cents, isNegative, error: null };
}

// ── Helpers ──

function formatISODate(d) {
  // Use UTC methods to avoid timezone shifts — dates from spreadsheet parsers
  // (ExcelJS, Date.parse of ISO strings) are stored as UTC midnight.
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
