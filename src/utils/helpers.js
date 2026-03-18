// Currency formatting utilities

// ── Safe-mode masking (module-level flag set by SafeModeProvider) ──

let _safeModeEnabled = false;
let _safeModeSeed = 1;
const _accountNameMap = new Map(); // original name → masked name
let _accountNameCounter = 0;

/**
 * Called by SafeModeProvider to toggle masking on/off.
 * @param {boolean} enabled
 * @param {number} seed  - stable per-session multiplier (0.4 – 2.5)
 */
export function setSafeModeEnabled(enabled, seed = 1) {
  _safeModeEnabled = enabled;
  _safeModeSeed = seed;
  if (!enabled) {
    _accountNameMap.clear();
    _accountNameCounter = 0;
  }
}

/** Returns true when safe-mode masking is active. */
export function isSafeModeActive() {
  return _safeModeEnabled;
}

/**
 * Deterministically scramble a cents value so it looks realistic
 * but is consistently different from the real value within a session.
 */
function scrambleCents(cents) {
  if (cents === 0) return 0;
  const sign = cents < 0 ? -1 : 1;
  const abs = Math.abs(cents);
  // Use a sin-based warp so different magnitudes get different scaling
  const warp = 0.7 + 0.6 * Math.abs(Math.sin(abs * 0.00007 + _safeModeSeed));
  return sign * Math.round(abs * _safeModeSeed * warp);
}

/**
 * Scramble a dollar value (used by chart axes that work in dollars).
 */
function scrambleDollars(dollars) {
  return scrambleCents(Math.round(dollars * 100)) / 100;
}

/**
 * Mask an account / entity name → "Account A", "Account B", etc.
 * Returns the original name when safe mode is off.
 */
export function maskAccountName(name) {
  if (!_safeModeEnabled || !name) return name;
  if (_accountNameMap.has(name)) return _accountNameMap.get(name);
  const letter = String.fromCharCode(65 + (_accountNameCounter % 26));
  const suffix =
    _accountNameCounter >= 26 ? Math.floor(_accountNameCounter / 26) : "";
  const masked = `Account ${letter}${suffix}`;
  _accountNameMap.set(name, masked);
  _accountNameCounter++;
  return masked;
}

/**
 * Format a dollar axis-tick value respecting safe-mode masking.
 * Intended for Recharts tickFormatter callbacks that bypass formatCurrency.
 */
export function formatAxisDollar(v) {
  const val = _safeModeEnabled ? scrambleDollars(v) : v;
  return `$${val.toLocaleString()}`;
}

/**
 * Signed axis formatter (for charts that show negative values).
 */
export function formatAxisDollarSigned(v) {
  const val = _safeModeEnabled ? scrambleDollars(v) : v;
  return `${val < 0 ? "-" : ""}$${Math.abs(val).toLocaleString()}`;
}

// ── Category type constants (shared across components) ──

export const CATEGORY_TYPE_ORDER = [
  "income",
  "needs",
  "wants",
  "savings",
  "transfer",
];
export const CATEGORY_TYPE_LABELS = {
  income: "Income",
  needs: "Needs",
  wants: "Wants",
  savings: "Savings",
  transfer: "Transfer",
};

// ── Transaction classification helpers ──

/**
 * Returns true only when a transaction is genuine income
 * (is_income flag AND the category is an 'income'-type category).
 * Credits (refunds, returns) in spending categories return false.
 *
 * @param {{ is_income: boolean, categories?: { type?: string } }} transaction
 * @returns {boolean}
 */
export function isTrueIncome(transaction) {
  return !!transaction.is_income && transaction.categories?.type === "income";
}

/**
 * Returns true when a transaction is a credit (is_income) assigned to a
 * spending category (needs / wants / savings).  These credits should reduce
 * the spending total for their category rather than count as income.
 *
 * @param {{ is_income: boolean, categories?: { type?: string } }} transaction
 * @returns {boolean}
 */
export function isSpendingCredit(transaction) {
  return (
    !!transaction.is_income &&
    transaction.categories?.type !== "income" &&
    transaction.categories?.type !== "transfer"
  );
}

/**
 * Returns true when a transaction is a debit (is_income=false) assigned to
 * an income category.  These debits should reduce the income total for their
 * category rather than count as an expense.
 *
 * @param {{ is_income: boolean, categories?: { type?: string } }} transaction
 * @returns {boolean}
 */
export function isIncomeDebit(transaction) {
  return !transaction.is_income && transaction.categories?.type === "income";
}

/**
 * Convert dollars to cents
 * @param {number} dollars - Amount in dollars
 * @returns {number} Amount in cents
 */
export const toCents = (dollars) => {
  return Math.round(Number(dollars) * 100);
};

/**
 * Convert cents to dollars
 * @param {number} cents - Amount in cents
 * @param {object} [opts]
 * @param {boolean} [opts.raw=false] - When true, bypass safe-mode masking (use for math, not display)
 * @returns {number} Amount in dollars
 */
export const toDollars = (cents, { raw = false } = {}) => {
  const c =
    !raw && _safeModeEnabled ? scrambleCents(Number(cents)) : Number(cents);
  return c / 100;
};

/**
 * Format cents as currency string
 * @param {number} cents - Amount in cents
 * @param {string} currency - ISO currency code (default: 'USD')
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (
  cents,
  currency = "USD",
  { hideCents = false } = {},
) => {
  const safeCents = _safeModeEnabled ? scrambleCents(cents) : cents;
  const dollars = safeCents / 100;
  const options = {
    style: "currency",
    currency: currency,
  };
  if (hideCents) {
    options.minimumFractionDigits = 0;
    options.maximumFractionDigits = 0;
  }
  return new Intl.NumberFormat("en-US", options).format(dollars);
};

/**
 * Format date for display
 * @param {string|Date} date - Date to format
 * @returns {string} Formatted date string
 */
export const formatDate = (date) => {
  // Parse YYYY-MM-DD as local date (not UTC) to avoid off-by-one timezone issues
  const d =
    typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? new Date(date + "T00:00:00")
      : new Date(date);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

/**
 * Get month name from month number
 * @param {number} month - Month number (1-12)
 * @returns {string} Month name
 */
export const getMonthName = (month) => {
  const date = new Date(2000, month - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long" });
};

/**
 * Get current month and year
 * @returns {{month: number, year: number}}
 */
export const getCurrentMonthYear = () => {
  const now = new Date();
  return {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
};

// ── Month name lookup for CSV import ──

const FULL_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const SHORT_MONTHS_MAP = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Try to map a header string to a month index 0-11, or return -1.
 */
function headerToMonthIndex(header) {
  const h = header.trim().toLowerCase();
  const fullIdx = FULL_MONTHS.indexOf(h);
  if (fullIdx !== -1) return fullIdx;
  const shortKey = h.slice(0, 3);
  if (shortKey in SHORT_MONTHS_MAP) return SHORT_MONTHS_MAP[shortKey];
  return -1;
}

/**
 * Parse a CSV string in the format:
 *   Category, January, February, …, December
 *   Groceries, 400, 350, …, 400
 *
 * Returns { rows, error }.
 *   rows: Array<{ categoryName: string, monthAmounts: number[12] }>
 *   error: string | null
 *
 * Month columns can appear in any order; unrecognized columns are ignored.
 * Dollar values may contain "$", ",", or be blank (treated as 0).
 */
export function parseBudgetCSV(csvText) {
  if (!csvText || !csvText.trim()) {
    return { rows: [], error: "File is empty." };
  }

  // Split into lines, trim, drop empties
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return {
      rows: [],
      error: "CSV must have a header row and at least one data row.",
    };
  }

  // Parse header
  const headers = lines[0].split(",").map((h) => h.trim());
  if (headers.length < 2) {
    return {
      rows: [],
      error:
        "Header row must have at least two columns (Category + one month).",
    };
  }

  // Map column index → month index (0-11). First column is the category name.
  const colToMonth = {}; // { colIdx: monthIdx }
  for (let c = 1; c < headers.length; c++) {
    const mi = headerToMonthIndex(headers[c]);
    if (mi !== -1) colToMonth[c] = mi;
  }

  if (Object.keys(colToMonth).length === 0) {
    return {
      rows: [],
      error:
        'No recognizable month columns found in the header row. Expected names like "January" or "Jan".',
    };
  }

  // Parse data rows
  const rows = [];
  const errors = [];

  for (let r = 1; r < lines.length; r++) {
    const cells = lines[r].split(",").map((c) => c.trim());
    const categoryName = cells[0];
    if (!categoryName) {
      errors.push(`Row ${r + 1}: missing category name.`);
      continue;
    }

    const monthAmounts = new Array(12).fill(0);

    for (const [colStr, mi] of Object.entries(colToMonth)) {
      const col = Number(colStr);
      const raw = (cells[col] || "").replace(/[$,]/g, "").trim();
      if (raw === "") continue;
      const val = parseFloat(raw);
      if (Number.isNaN(val)) {
        errors.push(
          `Row ${r + 1}, "${headers[col]}": "${cells[col]}" is not a valid number.`,
        );
        continue;
      }
      if (val < 0) {
        errors.push(
          `Row ${r + 1}, "${headers[col]}": negative value (${val}) treated as positive (${Math.abs(val)}).`,
        );
      }
      monthAmounts[mi] = Math.abs(val); // dollars (converted to cents later)
    }

    rows.push({ categoryName, monthAmounts });
  }

  if (rows.length === 0) {
    return {
      rows: [],
      error: errors.length ? errors.join("\n") : "No data rows found.",
    };
  }

  return { rows, error: errors.length ? errors.join("\n") : null };
}
