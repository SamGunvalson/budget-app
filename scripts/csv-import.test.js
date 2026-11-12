import { randomUUID } from 'node:crypto';
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";
import * as csvParser from "../src/utils/csvParser.js";

const { guessColumnMapping, normalizeAmount, normalizeDate, parseCsvText, parseSpreadsheetFile } = csvParser;

const importSource = readFileSync(new URL("../src/services/import.js", import.meta.url), "utf8");

// Loads src/services/import.js with a fake backend. `responses` are returned
// in order, one per awaited query; every insert payload is recorded.
async function loadImport({ responses = [] } = {}) {
  const inserts = [];
  const supabase = {
    from() {
      let payload = null;
      const query = {
        then(resolve, reject) {
          assert.ok(responses.length, "Unexpected query");
          const next = responses.shift();
          const result = typeof next === "function" ? next(payload) : next;
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      for (const method of ["select", "is", "gte", "lte", "order", "range"]) {
        query[method] = () => query;
      }
      query.insert = (rows) => {
        payload = rows;
        inserts.push(rows);
        return query;
      };
      return query;
    },
  };
  const dependencies = {
    "./supabase": { supabase, getCurrentUser: async () => ({ id: "owner" }) },
    "../utils/ids": { newId: () => randomUUID() },
    "../utils/csvParser": { normalizeDate, normalizeAmount },
  };
  const module = new SourceTextModule(importSource);
  await module.link((specifier) => {
    const exports = dependencies[specifier];
    assert.ok(exports, `Unexpected import ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    });
  });
  await module.evaluate();
  return { service: module.namespace, inserts };
}

const csvFile = (text, name = "bank.csv") => {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, arrayBuffer: async () => bytes.buffer };
};

// ── normalizeAmount (SVC-2) ──

test("normalizeAmount finds the sign wherever it sits relative to the currency symbol", () => {
  for (const input of ["-12.50", "-$12.50", "$-12.50", "$ -12.50", "(12.50)", "($12.50)", "12.50-", "$12.50-"]) {
    assert.deepEqual(normalizeAmount(input), { cents: 1250, isNegative: true, error: null }, input);
  }
  for (const input of ["12.50", "$12.50", "+12.50", " 12.5 ", "€12.50"]) {
    assert.deepEqual(normalizeAmount(input), { cents: 1250, isNegative: false, error: null }, input);
  }
  assert.deepEqual(normalizeAmount("$1,234.56"), { cents: 123456, isNegative: false, error: null });
  assert.deepEqual(normalizeAmount("123,456.78"), { cents: 12345678, isNegative: false, error: null });
  assert.equal(normalizeAmount(".5").cents, 50);
  assert.equal(normalizeAmount("5.").cents, 500);
  assert.equal(normalizeAmount("0").cents, 0);
});

test("normalizeAmount rejects values that are not a single plain number", () => {
  for (const input of ["12/05/2024", "2024-12-05", "1.2.3", "1e5", "12,5", "1,23", "abc12", "12abc", "--5", "$", "-", "()", "Infinity", "NaN"]) {
    const result = normalizeAmount(input);
    assert.equal(result.cents, null, input);
    assert.match(result.error, /Not a valid number/, input);
  }
  assert.equal(normalizeAmount("").error, "Empty amount");
  assert.equal(normalizeAmount(null).error, "Empty amount");
});

test("normalizeAmount validates and caps numeric cells like strings", () => {
  assert.deepEqual(normalizeAmount(-5.5), { cents: 550, isNegative: true, error: null });
  assert.deepEqual(normalizeAmount(19.99), { cents: 1999, isNegative: false, error: null });
  for (const input of [NaN, Infinity, -Infinity]) {
    assert.equal(normalizeAmount(input).cents, null);
    assert.match(normalizeAmount(input).error, /Not a valid number/);
  }
  assert.equal(normalizeAmount(999_999.99).cents, 99_999_999);
  for (const input of [1_000_000, -1_000_000, 1e12, "1000000", "1,000,000.00", "(1000000)"]) {
    assert.equal(normalizeAmount(input).cents, null, String(input));
    assert.match(normalizeAmount(input).error, /exceeds maximum/, String(input));
  }
});

test("normalizeAmount never returns negative cents", () => {
  for (const input of ["$-12.50", "-0.01", "(3)", -7, "7-"]) {
    assert.ok(normalizeAmount(input).cents >= 0, String(input));
  }
});

// ── normalizeDate (SVC-3, SVC-4) ──

test("normalizeDate rejects impossible calendar dates", () => {
  for (const input of ["2024-02-31", "2023-02-29", "2024-13-01", "2024-00-10", "2024/04/31", "02/30/2024", "13/01/2024", "04-31-24", "31/12/2024"]) {
    const result = normalizeDate(input);
    assert.equal(result.date, null, input);
    assert.ok(result.error, input);
  }
  assert.equal(normalizeDate("2024-02-29").date, "2024-02-29");
  assert.equal(normalizeDate("12/31/2024").date, "2024-12-31");
  assert.equal(normalizeDate("1/5/24").date, "2024-01-05");
  assert.equal(normalizeDate("2024-03-05T10:00:00Z").date, "2024-03-05");
});

test("normalizeDate keeps the calendar day in zones east and west of UTC", () => {
  const script = `
    import { normalizeDate } from ${JSON.stringify(new URL("../src/utils/csvParser.js", import.meta.url).href)};
    const inputs = ["Mar 5, 2024", "5 March 2024", "March 5 2024", "2024-03-05", "03/05/2024", "3/5/24"];
    const out = inputs.map((value) => normalizeDate(value).date);
    // xlsx date cells arrive as UTC-midnight Date objects.
    out.push(normalizeDate(new Date(Date.UTC(2024, 2, 5))).date);
    out.push(normalizeDate(new Date(Date.UTC(2024, 0, 1))).date);
    out.push(normalizeDate(new Date(Date.UTC(2024, 11, 31))).date);
    console.log(JSON.stringify(out));
  `;
  for (const TZ of ["Australia/Sydney", "America/Los_Angeles", "UTC", "Pacific/Kiritimati"]) {
    const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, TZ },
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    });
    assert.deepEqual(
      JSON.parse(stdout),
      ["2024-03-05", "2024-03-05", "2024-03-05", "2024-03-05", "2024-03-05", "2024-03-05", "2024-03-05", "2024-01-01", "2024-12-31"],
      TZ,
    );
  }
});

// ── CSV parsing (SVC-1) ──

test("parseCsvText handles quotes, escapes, embedded delimiters and all line endings", () => {
  assert.deepEqual(parseCsvText('a,b,c\r\n1,"x, y","say ""hi"""\r\n'), [
    ["a", "b", "c"],
    ["1", "x, y", 'say "hi"'],
  ]);
  assert.deepEqual(parseCsvText('a,b\n"line1\nline2",2'), [["a", "b"], ["line1\nline2", "2"]]);
  assert.deepEqual(parseCsvText("a,b\r1,2\r3,4"), [["a", "b"], ["1", "2"], ["3", "4"]]);
  assert.deepEqual(parseCsvText("﻿a,b\n 1 , 2 \n"), [["a", "b"], ["1", "2"]]);
  assert.deepEqual(parseCsvText('a\n" padded "\n'), [["a"], [" padded "]]);
  assert.deepEqual(parseCsvText(""), []);
  assert.throws(() => parseCsvText('a,b\n"open,2\n'), /Unterminated/);
});

test("parseCsvText drops blank rows and leaves empty cells unset like the xlsx path", () => {
  const rows = parseCsvText("a,b,c\n\n,,\n1,,3\n,,\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, 3);
  assert.equal(1 in rows[1], false);
  assert.deepEqual([rows[1][0], rows[1][2]], ["1", "3"]);
});

test("parseSpreadsheetFile reads a .csv into header-keyed string rows", async () => {
  const result = await parseSpreadsheetFile(
    csvFile('Date,Amount,Description,__proto__\n2024-03-05,"$1,234.56","Coffee, ""large""",x\n\n03/06/2024,-5,,\n'),
  );
  assert.equal(result.error, null);
  assert.deepEqual(result.headers, ["Date", "Amount", "Description", "___proto__"]);
  assert.deepEqual(
    result.rows.map((row) => ({ ...row })),
    [
      { Date: "2024-03-05", Amount: "$1,234.56", Description: 'Coffee, "large"', ___proto__: "x" },
      { Date: "03/06/2024", Amount: "-5", Description: "", ___proto__: "" },
    ],
  );
  assert.equal(normalizeDate(result.rows[0].Date).date, "2024-03-05");
  assert.deepEqual(normalizeAmount(result.rows[0].Amount), { cents: 123456, isNegative: false, error: null });
});

test("parseSpreadsheetFile reports CSV files without data rows", async () => {
  assert.match((await parseSpreadsheetFile(csvFile("Date,Amount\n"))).error, /header row and at least one data row/);
  assert.match((await parseSpreadsheetFile(csvFile('Date,Amount\n"1,2\n'))).error, /Failed to parse file: Unterminated/);
});

test("blank header cells get placeholder names instead of holes", async () => {
  for (const [text, expected] of [
    [",Date,Amount\n0,2024-03-05,5\n", ["Column 1", "Date", "Amount"]],
    ["Date,,Amount\n2024-03-05,x,5\n", ["Date", "Column 2", "Amount"]],
    ['Date," ",Amount\n2024-03-05,x,5\n', ["Date", "Column 2", "Amount"]],
  ]) {
    const result = await parseSpreadsheetFile(csvFile(text));
    assert.equal(result.error, null, text);
    assert.deepEqual(result.headers, expected, text);
    // Dense: no holes for .map/.forEach consumers to skip.
    assert.equal(Object.keys(result.headers).length, expected.length, text);
    const mapping = guessColumnMapping(result.headers);
    assert.equal(mapping.date, "Date", text);
    assert.equal(mapping.amount, "Amount", text);
    assert.equal(result.rows[0].Date, "2024-03-05", text);
    assert.equal(result.rows[0].Amount, "5", text);
  }
  const indexed = await parseSpreadsheetFile(csvFile(",Date,Amount\n0,2024-03-05,5\n"));
  assert.equal(indexed.rows[0]["Column 1"], "0");
});

test("normalizeDate only accepts 2- or 4-digit years in US-style dates", () => {
  for (const input of ["3/5/202", "3/5/2", "03-05-20245", "3/5/024"]) {
    const result = normalizeDate(input);
    assert.equal(result.date, null, input);
    assert.match(result.error, /Cannot parse date/, input);
  }
  assert.equal(normalizeDate("3/5/24").date, "2024-03-05");
  assert.equal(normalizeDate("3/5/2024").date, "2024-03-05");
  assert.equal(normalizeDate("3/5/2024 10:15").date, "2024-03-05");
  // Numeric cells (e.g. an xlsx 0) are not dates.
  assert.equal(normalizeDate(0).date, null);
  assert.equal(normalizeDate(45000).date, null);
});

// ── validateAndTransform (SVC-2, SVC-4) ──

const categories = [
  { id: "cat-food", name: "Groceries", type: "needs" },
  { id: "cat-xfer", name: "Account Transfer", type: "transfer" },
];
const row = (overrides = {}) => ({
  date: "2024-03-05",
  amount: 1250,
  isExpense: true,
  description: "Walmart",
  payee: "",
  csvAccount: "Checking",
  _amountPreResolved: true,
  ...overrides,
});

test("validateAndTransform requires a real date, a category and an account", async () => {
  const { service } = await loadImport();
  const { valid, errors } = service.validateAndTransform(
    [
      row(),
      row({ date: "2024-02-31" }),
      row({ description: "zzz" }),
      row({ csvAccount: "Unknown" }),
      row({ csvAccount: "" }),
      row({ amount: -1250 }),
      row({ amount: 12.5 }),
    ],
    categories,
    {},
    { Checking: "acct-1" },
  );
  assert.deepEqual(valid, [
    {
      amount: 1250,
      description: "Walmart",
      payee: "",
      transaction_date: "2024-03-05",
      category_id: "cat-food",
      account_id: "acct-1",
      is_income: false,
      _rowIndex: 0,
    },
  ]);
  assert.deepEqual(
    errors.map((e) => [e.rowIndex, e.field]),
    [[1, "date"], [2, "category"], [3, "account"], [4, "account"], [5, "amount"], [6, "amount"]],
  );
});

test("validateAndTransform uses the default account when a row names none", async () => {
  const { service } = await loadImport();
  const { valid, errors } = service.validateAndTransform([row({ csvAccount: "" })], categories, {}, { __default: "acct-9" });
  assert.deepEqual(errors, []);
  assert.equal(valid[0].account_id, "acct-9");
});

// ── checkDuplicates (UI-5) ──

test("checkDuplicates throws instead of reporting no duplicates when the query fails", async () => {
  const { service } = await loadImport({ responses: [{ data: null, error: { message: "network down" } }] });
  await assert.rejects(
    service.checkDuplicates([{ _rowIndex: 0, transaction_date: "2024-03-05", amount: 1250 }]),
    /Could not check for duplicates: network down/,
  );
});

test("checkDuplicates flags rows matching an existing date and amount", async () => {
  const existing = [{ id: "t1", amount: 1250, transaction_date: "2024-03-05", description: "old" }];
  const { service } = await loadImport({ responses: [{ data: existing, error: null }] });
  const dupes = await service.checkDuplicates([
    { _rowIndex: 0, transaction_date: "2024-03-05", amount: 1250 },
    { _rowIndex: 1, transaction_date: "2024-03-05", amount: 999 },
    { _rowIndex: 2, transaction_date: "2024-03-06", amount: 1250 },
  ]);
  assert.deepEqual(dupes, [{ rowIndex: 0, existingTransaction: existing[0] }]);
});

test("groupDuplicatesForReview keeps both legs of a transfer pair in one group", async () => {
  const { service } = await loadImport();
  const valid = [0, 1, 2, 3, 5].map((i) => ({ _rowIndex: i, amount: 100 + i }));
  const pairs = new Map([[1, 3], [3, 1], [4, 5], [5, 4]]);
  const rowIndexes = (groups) => groups.map((g) => [g.key, g.rows.map((r) => r._rowIndex)]);

  // Only one leg (3) is a duplicate: its partner (1) joins the group.
  assert.deepEqual(rowIndexes(service.groupDuplicatesForReview(valid, [{ rowIndex: 0 }, { rowIndex: 3 }], pairs)), [
    [0, [0]],
    [1, [1, 3]],
  ]);
  // Both legs duplicates: still one group, not two.
  assert.deepEqual(rowIndexes(service.groupDuplicatesForReview(valid, [{ rowIndex: 1 }, { rowIndex: 3 }], pairs)), [
    [1, [1, 3]],
  ]);
  // Partner (4) failed validation and is not being imported: the leg stands alone.
  assert.deepEqual(rowIndexes(service.groupDuplicatesForReview(valid, [{ rowIndex: 5 }], pairs)), [[5, [5]]]);
  // One-directional pair maps are handled too.
  assert.deepEqual(rowIndexes(service.groupDuplicatesForReview(valid, [{ rowIndex: 3 }], new Map([[1, 3]]))), [
    [1, [1, 3]],
  ]);
  assert.deepEqual(service.groupDuplicatesForReview(valid, []), []);
});

// ── batching (SVC-4) ──

const tx = (i, overrides = {}) => ({
  amount: 100 + i,
  description: `row ${i}`,
  payee: "",
  transaction_date: "2024-03-05",
  category_id: "cat-food",
  account_id: "acct-1",
  is_income: false,
  _rowIndex: i,
  ...overrides,
});

test("buildInsertBatches never splits a transfer group across batches", async () => {
  const { service } = await loadImport();
  const rows = Array.from({ length: 7 }, (_, i) => ({ n: i, transfer_group_id: null }));
  rows[2].transfer_group_id = "g1";
  rows[6].transfer_group_id = "g1";
  const batches = service.buildInsertBatches(rows, 3);
  assert.deepEqual(batches.map((b) => b.map((r) => r.n)), [[0, 1], [2, 6, 3], [4, 5]]);
  assert.ok(batches.every((b) => b.length <= 3));
  assert.deepEqual(service.buildInsertBatches([], 3), []);
});

test("bulkInsertTransactions keeps both transfer legs in one batch", async () => {
  const ok = (rows) => ({ data: rows.map((_, i) => ({ id: i })), error: null });
  const { service, inserts } = await loadImport({ responses: [ok, ok, ok] });
  const transactions = Array.from({ length: 205 }, (_, i) => tx(i));
  // Legs sit either side of the 100-row boundary.
  const pairs = new Map([[99, 100], [100, 99]]);
  const result = await service.bulkInsertTransactions(transactions, pairs);

  assert.deepEqual(result, { inserted: 205, failed: 0, errors: [] });
  assert.ok(inserts.every((batch) => batch.length <= 100));
  assert.equal(inserts.flat().length, 205);
  const legBatches = inserts
    .map((batch, i) => (batch.some((r) => r.transfer_group_id) ? i : -1))
    .filter((i) => i >= 0);
  assert.equal(legBatches.length, 1);
  const legs = inserts[legBatches[0]].filter((r) => r.transfer_group_id);
  assert.deepEqual(legs.map((r) => r.description).sort(), ["row 100", "row 99"]);
  assert.equal(legs[0].transfer_group_id, legs[1].transfer_group_id);
  assert.ok(inserts.flat().every((r) => r.user_id === "owner" && !("_rowIndex" in r)));
});

test("bulkInsertTransactions does not link a transfer leg whose partner is not being inserted", async () => {
  const ok = (rows) => ({ data: rows.map((_, i) => ({ id: i })), error: null });
  const { service, inserts } = await loadImport({ responses: [ok] });
  await service.bulkInsertTransactions([tx(0), tx(2)], new Map([[0, 1], [1, 0]]));
  assert.deepEqual(inserts[0].map((r) => r.transfer_group_id), [null, null]);
});

test("bulkInsertTransactions counts a failed batch without stopping later batches", async () => {
  const ok = (rows) => ({ data: rows.map((_, i) => ({ id: i })), error: null });
  const { service } = await loadImport({ responses: [{ data: null, error: { message: "boom" } }, ok] });
  const result = await service.bulkInsertTransactions(Array.from({ length: 150 }, (_, i) => tx(i)));
  assert.deepEqual(result, { inserted: 50, failed: 100, errors: ["Batch 1: boom"] });
});

// ── report (UI-7) ──

test("generateImportReport labels file-level errors and counts skipped duplicates", async () => {
  const { service } = await loadImport();
  const report = service.generateImportReport({
    inserted: 1,
    failed: 0,
    errors: [],
    skippedDuplicates: 2,
    invalidRows: [
      { rowIndex: -1, field: "file", message: "too big" },
      { rowIndex: 3, field: "date", message: "bad" },
    ],
  });
  assert.match(report, /Skipped as possible duplicates: 2/);
  assert.match(report, /^File,"file","too big"$/m);
  assert.match(report, /^5,"date","bad"$/m);
});
