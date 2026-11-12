// Phase 5: code-split the exceljs bundle.  parseSpreadsheetFile is only
// called when the user picks a file in the import flow, so we lazy-load the
// library on first use and cache the module for subsequent calls.
let _excelJsPromise = null;
function loadExcelJs() {
  if (!_excelJsPromise) {
    _excelJsPromise = import("exceljs").then((m) => m.default || m);
  }
  return _excelJsPromise;
}

/**
 * Parse a CSV or Excel file into an array of row objects.
 * CSV text is tokenized directly; ExcelJS handles .xlsx.
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
    // Convert to array-of-arrays for processing
    let aoa;
    if (file.name.toLowerCase().endsWith(".csv")) {
      // exceljs' csv.read() needs a Node stream and cannot take an ArrayBuffer,
      // so CSV text is tokenized here. Cells stay strings; normalizeDate and
      // normalizeAmount interpret them later.
      const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
      aoa = parseCsvText(text);
    } else {
      aoa = await readXlsxRows(await file.arrayBuffer());
      if (!aoa) {
        return { headers: [], rows: [], error: "The file contains no sheets." };
      }
    }

    if (aoa.length < 2) {
      return {
        headers: [],
        rows: [],
        error: "File must have a header row and at least one data row.",
      };
    }

    // Build headers densely: aoa rows are sparse (empty cells are unset), and
    // a blank header cell ("Date,,Amount", or a leading index column) must
    // still get a usable name rather than a hole.
    const rawHeaders = Array.from({ length: aoa[0].length }, (_, idx) => {
      const cell = aoa[0][idx];
      const name =
        cell === undefined || cell === null ? "" : String(cell).trim();
      return name || `Column ${idx + 1}`;
    });

    // Reject headers that would clobber Object.prototype when used as keys.
    // Belt-and-braces: rows are also constructed via Object.create(null) below,
    // but rejecting here surfaces a clear error to the user.
    const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
    const headers = rawHeaders.map((h) =>
      FORBIDDEN_KEYS.has(h) ? `_${h}` : h,
    );

    // Build row objects keyed by header (prototype-less to defeat any
    // remaining injection attempt via crafted column names).
    const rows = [];
    for (let i = 1; i < aoa.length; i++) {
      const cells = aoa[i];
      // Skip completely empty rows
      if (cells.every((c) => c === "" || c === null || c === undefined))
        continue;

      const row = Object.create(null);
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

/**
 * Tokenize CSV text (RFC 4180: quoted fields, "" escapes, embedded commas and
 * newlines, CRLF/LF/CR line endings) into the same sparse array-of-arrays
 * shape the xlsx path produces: empty cells are left unset and rows with no
 * non-empty cell are dropped.
 *
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsvText(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let col = 0;
  let inQuotes = false;
  let wasQuoted = false;
  let rowHasValue = false;

  const endField = () => {
    const value = wasQuoted ? field : field.trim();
    if (value !== "") {
      row[col] = value;
      rowHasValue = true;
    }
    field = "";
    wasQuoted = false;
    col++;
  };
  const endRow = () => {
    endField();
    if (rowHasValue) rows.push(row);
    row = [];
    col = 0;
    rowHasValue = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field.trim() === "" && !wasQuoted) {
      field = "";
      inQuotes = true;
      wasQuoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else if (!wasQuoted || ch.trim() !== "") {
      field += ch;
    }
  }
  if (inQuotes) throw new Error("Unterminated quoted field in CSV.");
  if (field !== "" || wasQuoted || col > 0) endRow();

  return rows;
}

// Read the first worksheet of an .xlsx file into an array-of-arrays, or null
// when the workbook has no sheets.
async function readXlsxRows(arrayBuffer) {
  const ExcelJS = await loadExcelJs();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.getWorksheet(1);
  if (!worksheet) return null;

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
      // Keep a numeric 0 so it is reported as a zero amount, not an empty one.
      rowValues[colNumber - 1] = value === 0 ? 0 : value || "";
    });
    aoa.push(rowValues);
  });
  return aoa;
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

  // A bare number is not a date (and Date.parse would turn "0" into 2000).
  if (typeof value === "number") {
    return { date: null, error: `Cannot parse date: "${value}"` };
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
    return isRealDate(y, m, d)
      ? { date: formatYMD(y, m, d), error: null }
      : { date: null, error: `Not a real calendar date: "${str}"` };
  }

  // Try US format: MM/DD/YYYY or MM-DD-YYYY
  // Format directly from capture groups to avoid Date constructor timezone issues
  const usMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d+)/);
  if (usMatch) {
    // Only 2- or 4-digit years; "3/5/202" is a typo, not the year 202.
    if (usMatch[3].length !== 2 && usMatch[3].length !== 4) {
      return { date: null, error: `Cannot parse date: "${str}"` };
    }
    let year = +usMatch[3];
    if (year < 100) year += 2000;
    const m = +usMatch[1],
      d = +usMatch[2];
    return isRealDate(year, m, d)
      ? { date: formatYMD(year, m, d), error: null }
      : { date: null, error: `Not a real calendar date: "${str}"` };
  }

  // Try Date.parse as last resort. Non-ISO strings ("Mar 5, 2024") are parsed
  // as local time, so read the local calendar parts back.
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return {
      date: formatYMD(
        parsed.getFullYear(),
        parsed.getMonth() + 1,
        parsed.getDate(),
      ),
      error: null,
    };
  }

  return { date: null, error: `Cannot parse date: "${str}"` };
}

const MAX_AMOUNT_CENTS = 99_999_999;

/**
 * Normalize an amount value from a spreadsheet cell into cents (integer).
 * Handles: "$1,234.56", "(100.50)", "-50", "$-50", "50-", "1234", etc.
 * cents is always the non-negative magnitude; the sign is in isNegative.
 *
 * @param {*} value
 * @returns {{ cents: number|null, isNegative: boolean, error: string|null }}
 */
export function normalizeAmount(value) {
  if (value === null || value === undefined || value === "") {
    return { cents: null, isNegative: false, error: "Empty amount" };
  }

  const invalid = () => ({
    cents: null,
    isNegative: false,
    error: `Not a valid number: "${value}"`,
  });

  let num;
  let isNegative = false;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) return invalid();
    isNegative = value < 0;
    num = Math.abs(value);
  } else {
    let str = String(value).trim();
    if (!str) return { cents: null, isNegative: false, error: "Empty amount" };

    // Parenthetical negatives: (123.45)
    if (str.startsWith("(") && str.endsWith(")")) {
      isNegative = true;
      str = str.slice(1, -1);
    }

    // Strip currency symbols and whitespace first so the sign is found
    // wherever it sits relative to the symbol: "-$5", "$-5", "5.00-".
    str = str.replace(/[$€£¥\s]/g, "");
    if (str.startsWith("-")) {
      isNegative = true;
      str = str.slice(1);
    } else if (str.startsWith("+")) {
      str = str.slice(1);
    } else if (str.endsWith("-")) {
      isNegative = true;
      str = str.slice(0, -1);
    }

    // Plain digits or correctly grouped thousands, with an optional decimal
    // part. Anything else (dates, "1.2.3", "1e5", "12,5") is rejected rather
    // than partially parsed.
    if (!/^(?=.*\d)(\d{1,3}(,\d{3})+|\d*)(\.\d*)?$/.test(str)) return invalid();
    num = Number(str.replace(/,/g, ""));
    if (!Number.isFinite(num)) return invalid();
  }

  const cents = Math.round(num * 100);
  if (cents > MAX_AMOUNT_CENTS) {
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
  // Date objects only come from the xlsx reader, which stores date cells as
  // UTC midnight — read UTC parts so the calendar day does not shift.
  return formatYMD(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function formatYMD(y, m, d) {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// True only when y-m-d exists on the calendar (rejects 2024-02-31, month 13).
function isRealDate(y, m, d) {
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}
