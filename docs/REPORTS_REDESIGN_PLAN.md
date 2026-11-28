# Reports Redesign Plan

Status: PRs 1–3 done · PR 4 (Payees) done, uncommitted · PRs 5–6 pending · 2026-11-28
Follows: [UI_OVERHAUL_PLAN.md](UI_OVERHAUL_PLAN.md) (Phase 5 Overview moves here, inside Reports; `/app` keeps landing on Transactions)

## Goals

1. **Less repetition.** Each tab answers one question. Do not repeat the Budget
   page ("am I on plan?") or the Accounts page (net worth, cash flow, upcoming).
2. **Keep what works.** Keep Calendar and Annual Actuals mostly as they are. Keep
   the editable transaction drill-down, the main tool for finding and fixing
   miscategorized transactions. Keep the Monthly/YTD and Include-upcoming
   toggles.
3. **Add insight.** Show why spending moved, not only totals: category trends,
   the needs/wants/savings mix, fixed vs flexible spending, and payee
   consistency.

## Findings (current state)

| Tab | What it shows | Problem |
| --- | --- | --- |
| Summary | Net/Income/Expenses cards; income and spending horizontal bar charts with drill-down | Its YTD mode repeats Annual Actuals. Its only unique feature is the drill-down, which Plan vs Actual also has. |
| Plan vs Actual | 3 alert banners, 3 stat cards, diverging Income/Expenses/Net bars, category table with drill-down | Budget › Monthly already shows "left in plan" and progress for each category, from the same `get_plan_vs_actual` data. The banners, cards and chart all say the same thing. Unique: drill-down, YTD, include-upcoming. |
| Trends | One total spending-vs-income area chart (6m/12m/YoY); average/highest/lowest cards | No category breakdown, so it cannot explain a change. |
| Annual Actuals | Category × month actuals grid | Good. Cells cannot be clicked. |
| Calendar | Daily transactions grid | Good. |

Shell problems:
- Each tab lights up in its own color (gold, emerald, sky, violet, rose), and the
  Monthly/YTD toggle is gold or emerald. The style guide says the selected
  segment is ink, and the Reports accent is violet.
- The header is built by hand. Switch it to `PageHeader`.
- The control row differs on every tab. Annual Actuals has its own year arrows.
- The drill-down filtering is written twice, in `ReportsPage.jsx`
  (`getDrillDownTransactions`) and in `PlanVsActual.jsx` (`renderDrillDown`).

## Target structure

Tabs: **Overview · Categories · Trends · Annual · Calendar**. Overview is the
default Reports tab.

Session-state migration: map `reportsActiveView` `'summary'` to `'overview'` and
`'planVsActual'` to `'categories'`. Also read a `?view=` query param (plus
`?category=` / `?payee=`) so Overview cards can deep-link into Categories with a
row already expanded.

### Shared shell

- `PageHeader` with eyebrow and serif title. Tabs use the shared segmented
  control: ink selected state, no colors per tab.
- One control row for every tab, showing only the controls that apply:

  | Tab | Month/YTD | Month picker | Year picker | Include upcoming | Range 6m/12m/YoY |
  | --- | --- | --- | --- | --- | --- |
  | Overview | ✓ | ✓ | | ✓ | |
  | Categories | ✓ | ✓ | | ✓ | |
  | Trends | | ✓ (end month) | | ✓ | ✓ |
  | Annual | | | ✓ | ✓ | |
  | Calendar | | ✓ | | | |

  Annual's own year arrows move into this row.
- Mobile: short tab labels, the control row wraps, tables drop to two value
  columns (actual + change chip).

### Shared data layer

New pure module `src/utils/reportAggregations.js` with unit tests (runs in
`npm test`). Every function takes an already-settled transaction array
(`isSettledTransaction(t, asOf)`), uses `isTrueIncome` / `isSpendingCredit` /
`isIncomeDebit`, and skips transfers:

- `categoryMonthMatrix(txs)` returns `{ [categoryId]: { [YYYY-MM]: cents } }`
  plus per-type and income totals. This feeds Overview, Categories, Trends and
  Annual.
- `payeeGroups(txs, { ignore })` returns normalized payees with their category
  split.
- `fixedFlexibleByMonth(txs)`: fixed means `recurring_template_id` is not null.
- `typeMixByMonth(txs)` returns needs/wants/savings/income per month and the
  savings rate.
- `flowGraph(txs)` returns Sankey nodes and links for income → type → category.

Data source: `useTransactionsForYear(year)`, plus `year - 1` when a trailing
window crosses January. This is the same offline-capable path Annual Actuals
uses. **No schema change is needed.** If 24-month windows turn out slow, add a
`get_category_monthly_trend` RPC later through `/db-change`.

One drill-down helper, `useCategoryDrillDown({ txs, period })`, replaces both
copies. It returns `{ expanded, toggle, render }` and wraps `CategoryDrillDown`.
Every tab uses it.

## Tab specs

### 1. Overview: month in review (new, default)

A look back at the selected month or YTD, built in `Overview.jsx`. It does
**not** repeat the Budget hero or Accounts' Coming up.

1. **Forest hero:** what you saved and the savings rate, split into budgeted
   savings and money moved to savings; then what you kept after spending and
   how much of it is still in checking. Income and spending are the smaller
   figures.
2. **Compared with:** spending and income vs last month and the 3-month
   average (YTD: the same months last year), as signed change chips.
3. **Top movers:** up to 5 spending categories that moved at least $10 from
   the 3-month average (YTD: last year). Each links to Categories with that
   row expanded and the matching comparison selected.
4. **Needs attention:** pending review (links to Transactions), categories
   over plan (links to Categories › Plan), and spending in unbudgeted
   categories (links to Budgets), and payees split across categories (links to
   Categories › Payees). Category IDs are required, so there are no
   uncategorized rows to report.
5. **Largest purchases:** the top 5 one-off purchases. Bills are excluded:
   rows from a recurring template, and the same payee charging the same amount
   in 3+ months. Each links to its category's drill-down, where it can be edited.
6. **Where it went:** one stacked bar splitting income into Needs, Wants,
   Saved and Left in checking. Links to Trends.

Deep links: `?view=`, `?category=<id>` (opens that drill-down) and
`?compare=<mode>`. Picking a tab clears all three.

### 2. Categories (replaces Summary and Plan vs Actual)

One explorer for the period, with three views (segmented):

- **List** (default): rows grouped by type with subtotals. Income comes first.
  Built in `CategoryExplorer.jsx`.
  - **Compare to:** Monthly offers Plan | Last month | 3-mo average. YTD offers
    Plan | Last year (the same months a year earlier), because a 3-month
    average means little against a year to date. Each row shows the actual,
    the comparison value, the change, and a thin bar. Everything comes from
    `categoryMonthMatrix` and `useAnnualBudgetData`, so it works offline,
    like Annual Actuals; the server `usePlanVsActual` RPC is no longer used here.
  - Threshold coloring (warning and danger) only in Plan mode, using the same
    `categoryAlert` rules as Budgets.
  - Every row expands into the editable drill-down.
  - A one-line header: "Spent $X · Plan $Y · Income $Z". No banners, stat cards
    or diverging chart.
- **Payees** (`PayeeExplorer.jsx`): normalized payee rows over a fixed
  12-month window ending at the selected month (one month is too few visits
  to spot a pattern, so Monthly/YTD hides here). Each row shows total, count
  and category chips ("Groceries ×14 · Household ×2"), with the non-dominant
  categories highlighted as likely mistakes. Filters: Mixed (default), All,
  Ignored, plus search. Expanding a row opens the drill-down for that payee,
  where you can bulk recategorize; the row stays open even once it is no
  longer mixed. **Ignore** (shown on mixed or ignored payees) saves to the
  `user_preferences` key `payee_consistency_ignored` as `{ payees: [...] }`
  (existing key/value table, no schema change). Deep links: `?lens=payees`,
  `?payee=<normalized name>`.
- **Flow:** a Sankey chart, income → Needs/Wants/Savings → categories (recharts
  `Sankey`, already installed). Mobile shows a stacked bar per type instead.

### 3. Trends (rebuilt)

Range stays 6m / 12m / YoY. Sections:

1. **Income vs spending:** the existing chart. Average, highest and lowest
   become one caption line instead of three cards.
2. **Mix over time:** stacked monthly bars for needs/wants/savings, with a
   savings-rate line.
3. **Fixed vs flexible:** monthly recurring vs discretionary spending.
4. **Category trend:** pick a category or type to see its monthly line against
   its average. Below it, **Biggest changes**: risers and fallers, comparing the
   latest 3 months with the 3 before.

### 4. Annual (small changes)

- Clicking a cell opens the drill-down for that category and month in a sheet
  or modal, because the grid is too wide for inline expansion.
- Its year picker moves into the shared control row.

### 5. Calendar (unchanged)

Only adopts the shared control row.

## Removals

Remove `PlanVsActual.jsx`, `PlanVsActualChart.jsx`, `MonthlyStats.jsx`, the
Summary tab block in `ReportsPage.jsx`, and `CategoryChart.jsx` (once nothing
imports it). Remove `TrendSummary`'s cards. Keep `StatCards`, which recurring
views still use. Keep `BudgetAlert` if other pages import it.

## Decisions (defaults; change if wanted)

1. **Savings** comes from two places, matching how savings is recorded:
   - *Budgeted savings:* spending in Savings-type categories (401k, Roth IRA
     lines), including the categorized leg of a linked transfer.
   - *Moved to savings:* plain transfers (both legs in a transfer category)
     into savings, brokerage or retirement accounts, minus plain transfers out
     of them. Moves between two such accounts net to zero. Linked transfers are
     skipped here so they count once. See `transferSavingsByMonth`.

   **Savings rate** = (budgeted + moved) ÷ true income. **Kept** = income −
   needs − wants − other; kept minus saved is what is still in checking.
   Leftover moved in the following month counts in that month.
2. **Fixed** = any non-transfer transaction generated from a recurring template.
3. **Payee normalization:** trim, lowercase, collapse whitespace, drop trailing
   store numbers (`#1234`, `STORE 0042`). Fall back to `description` when
   `payee` is null. A payee is "mixed" when it has ≥3 transactions in more than
   one category.
4. **3-month average:** the 3 full months before the selected month. Zero months
   count.

## Suggested PR sequence

1. ✅ **Shell + data layer:** `PageHeader`, ink tabs, shared control row,
   `reportAggregations.js` with tests, `useCategoryDrillDown`. No new
   user-facing reports yet.
2. ✅ **Categories › List** with compare-to. Removes Summary and Plan vs Actual.
3. ✅ **Overview** tab (default).
4. ✅ **Categories › Payees** and the ignore list.
5. **Trends** rebuild (mix, fixed/flexible, category trend).
6. **Categories › Flow** (Sankey) and Annual cell drill-down.

Each PR: screenshots in light and dark at mobile and desktop widths,
`npm run verify`, and a `code-reviewer` pass. Safe mode: every new figure,
axis and Sankey label goes through `formatCurrency` / `toDollars` /
`formatAxisDollar` (charts mask once, then use `formatPreMasked*`).
