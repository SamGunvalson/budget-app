# Full code review — 2026-11-11

Reviewed at commit `6692818` (branch `category`). Seven read-only reviewers
covered `src/`, `server/auth/`, `scripts/`, `sql_scripts/`, and the Docker,
nginx and CI configuration. No application code was changed by the review.

## How to use this file

- Each finding has an ID. Work by ID and delete or tick the entry when fixed.
- **Status** says how far the finding was checked:
  - `verified` — the cited code was re-read (or the bug reproduced) after the
    reviewer reported it.
  - `reported` — the reviewer traced it, but it was not independently
    re-checked. Read the cited lines before fixing.
- Line numbers are as of the commit above and will drift as fixes land.
- After each fix run `/verify`. For anything under `sql_scripts/`, follow
  `/db-change`. Never run SQL against a live database from a session.

## Progress — 2026-11-12

Not started: DB-3 to DB-13, INF-3 to INF-14, UI-9, UI-10, UI-12, APP-10,
APP-14, APP-15, RPT-15, SVC-11, SVC-14.

✅ = fixed in the working tree (uncommitted), ◐ = partly fixed (reason inline).
Unit tests cover the pure logic; React wiring was verified by reading. Nothing
needing Docker/PostgreSQL has been run: the auth-service suite, the self-host
smoke test (now asserting CSP headers), and the RLS tests including the new
`sql_scripts/local/tests/partnerships_rls.sql`.

DB-1/DB-2 need `sql_scripts/migrations/supabase_partnership_hardening_rls.sql`
applied by hand to existing Supabase projects and self-hosted volumes.

Open decisions for the owner:

- Safe-mode gate: fail open or closed when the preference read fails; whether
  to time out the wait (APP-5 follow-up).
- Chart geometry in safe mode: scrambled shapes (current) or real shapes with
  masked labels (RPT-4).
- Whether edit inputs reveal real values in safe mode (UI-11).
- Imports without an account column need a default-account picker.
- Queued update whose server row no longer exists: drop, keep and surface, or
  re-create the local row — probably per table (OFF follow-up).
- SVC-7: add a column marking manual payments, or disallow future-dated ones.
- Recurring group "Net": the form and stored parent amount exclude transfers;
  the card, calendar and upcoming list now subtract outflow transfers (RPT-10).
- Modal is now a native dialog (UI-4): Escape closes forms with unsaved input;
  check nested/stacked modals and the Android back gesture in a browser.
- Behind an outer proxy (Caddy), auth rate limits share one bucket until a
  `real-ip.conf` snippet is mounted (INF-2).

## Suggested order

1. Data loss or corruption: OFF-1, RPT-1, RPT-2, RPT-3, OFF-2, OFF-6, UI-5, SVC-2
2. Security: DB-1, DB-2, INF-1, INF-2, APP-2, APP-3
3. Offline correctness: APP-1, OFF-3, OFF-4, OFF-5, and the rest of OFF
4. Import pipeline: SVC-1, SVC-3, SVC-4, UI-6, UI-7
5. Safe-mode leaks: RPT-4 to RPT-8, UI-11, APP-13
6. Everything else by severity

Several findings share one fix:

- OFF-1 to OFF-5 and APP-1 all come from writes that do not go through one
  queue-aware path. Fixing APP-1 and OFF-3 together avoids doing the work twice.
- RPT-1, RPT-2, RPT-4 and RPT-6 are all `toDollars` called without
  `{ raw: true }` for a value that is edited or re-formatted.
- APP-2, APP-3, APP-5 and OFF-15 are all "state not reset when the user changes".

---

## Offline and sync (OFF)

**✅ OFF-1 — critical — verified.** `src/services/offlineAware.js:225` (also
1032, 1400, 1632, 1735); push at `src/services/sync.js:344`.
Rows created offline are stored with `user_id: null` and `pushRow` upserts them
unchanged. `user_id` is `UUID NOT NULL` with no default or trigger
(`sql_scripts/supabase_schema_create.sql:27,56,78`), so the push fails, the row
stays pending forever, and it never reaches the server. Check first whether
the live database has a default that the scripts lack.
Fix: in `pushRow`, set `clean.user_id` from `getCurrentUser()` for creates and
drop a null `user_id` from updates; or fill it when the row is queued.

**✅ OFF-2 — high — verified.** `src/services/offlineAware.js:308-330`.
Deleting a transfer offline soft-deletes and queues only the given id. Sync
calls the `soft_delete_transaction` RPC for that one row; the companion-leg
logic lives in `deleteTransaction` (`src/services/transactions.js:681-730`),
which sync never calls. The other leg stays live on the server. The online
branch also updates only `id` in Dexie although the service returns all
deleted ids.
Fix: look up legs by `transfer_group_id`, mark and enqueue all of them; in the
online branch mark every id in `result.data`.

**✅ OFF-3 — high — reported.** `src/services/offlineAware.js:275-281`, also
211-216, 1039-1043, 1417-1421 and other online branches.
An online write does `db.<table>.put(result.data)` over a row that is still
pending, clearing its `_offline` flags and dropping the queued change. Example:
edit field A offline, reconnect before the push, edit field B; A is never sent.
The pending counter is not decremented. If the pending row was an unsynced
create, the online update fails with "row not found".
Fix: if the existing row is `_offline`, take the queued path regardless of
connectivity, or flush the queue before any online write.

**✅ OFF-4 — high — reported** (the unconditional clear is verified; the race is
inferred). `src/services/offlineDb.js:295-305` with `src/services/sync.js:295-308`.
`markSynced` clears the flags unconditionally, and the push loop works from a
snapshot. An edit made while a push is in flight is marked synced without
being pushed, then overwritten by the next pull.
Fix: clear only if `_offlineAt` still equals the pushed row's `_offlineAt`.

**✅ OFF-5 (budget items and preferences are natural-key upserts, handled under OFF-8) — high — reported.** `src/services/offlineAware.js:209-216, 339-349`
with `43-62`.
Online creates use a server-generated id. If the response is lost after the
insert commits, `tryOnline` reports offline and a second copy is queued with a
fresh UUID, so the row exists twice.
Fix: generate the id on the client before the online attempt and pass it to
the service, so a retry or sync upsert on `id` is idempotent.

**✅ OFF-6 — high — verified** (the clear is verified; loss of pending rows
follows from it). `src/services/offlineDb.js:162-172`, used at
`src/services/sync.js:210-216`.
The full-pull path does `table.clear()` then `bulkPut(rows)`, outside a
transaction. Pending offline rows are wiped, the counter is not decremented,
and readers briefly see an empty table.
Fix: wrap in a Dexie `rw` transaction and keep rows with `_offline === 1`.

**✅ OFF-7 — medium — reported.** `src/services/offlineAware.js:131-135,
287-292, 544-548` (also 593-597, 1259-1265, 1688-1690, 2006-2009).
Cached `categories`/`accounts` join objects on a transaction take precedence
over the live tables. Changing a transaction's category offline, or renaming a
category, leaves the old name, colour and type on the row; offline report
folds then classify by the old category type.
Fix: prefer the lookup over the stored join, and delete the join from the row
when `category_id` or `account_id` changes.

**✅ OFF-8 — medium — reported.** `src/services/offlineAware.js:1457-1486,
1519-1527, 1547-1555`.
Cached preference rows are created with a random id and `user_id: null`
instead of the server id. A later offline set pushes `update ... eq("id",
fakeId)`, matches nothing without error, and is marked synced. Offline-created
`budget_plans` and `budget_items` can collide with existing server rows on
their natural unique keys and stick as pending.
Fix: store the server row when caching preferences; push creates for these
tables with `onConflict` on the natural key.

**◐ OFF-9 (partial: server-only rpc_cache writes and clear-on-offline-write done; targeted invalidation/recompute not built) — medium — reported.** `src/services/offlineAware.js:684-727` with
`src/services/cache.js:158`.
Offline reads of RPC-derived data (balances, plan vs actual, trends, years)
come from `rpc_cache`, so offline mutations do not show until reconnect. When
online but the call fails, the local fold is written into `rpc_cache` as if it
were the server value.
Fix: invalidate or recompute the relevant `rpc_cache` entries on offline
writes; skip `writeRpcCache` when the fetch fell back to the local fold.

**✅ OFF-10 — medium — reported.** `src/services/offlineAware.js:181-204` with
`src/services/cache.js:196-228`.
Scope reconciliation deletes rows created after a background revalidation
fetch started: the new row is in scope, not pending, and not in `freshIds`.
Fix: reconcile-delete only rows older than the fetch start time.

**✅ OFF-11 — medium — reported.** `src/services/sync.js:211-216, 255-259`.
Watermarks use the client clock at the end of the fetch. Rows updated on the
server during a long fetch, or while the client clock runs ahead, are skipped
forever by `.gt("updated_at", lastSynced)`. See also DB-10.
Fix: record the timestamp before the fetch, minus a margin; use server
timestamps only.

**✅ OFF-12 — medium — reported.** `src/services/sync.js:92-119`,
`src/contexts/AuthContext.jsx:44-50`.
Boot runs `pullAll()` only. Pending rows from a previous session are not
pushed until an `online` event, a visibility change, or a manual click. Failed
pushes are not retried, and `_doSync` drains once.
Fix: call `requestSync()` after warm-up, loop until the queue is empty or no
progress is made, add backoff retry.

**✅ OFF-13 — medium — reported.** `src/services/offlineAware.js:50-58`.
The network-error classifier matches message text. Safari's `TypeError: Load
failed`, timeouts and aborts do not match, so the user gets a save error
instead of the offline queue. The `"network"` check is case-sensitive.
Fix: classify by error type or name and by status 0 / 502-504 as well.

**◐ OFF-14 (partial: category check added; changed-fields-only push needs a queue-format change) — low — reported.** `src/services/offlineAware.js:429-503`.
The offline asymmetric-transfer update skips `assertCachedCategoryAvailable`.
Sync pushes the whole row, so a stale offline edit overwrites other fields
changed on the server.
Fix: add the assertion; push only changed fields.

**✅ OFF-15 — low — reported.** `src/services/offlineDb.js:147-159, 247-283`.
`clearAllOfflineData` does not reset `_pendingCountCache`, so the next user in
the same tab sees a phantom pending badge.
Fix: set it to `null` there, or recompute from the tables.

---

## App shell: hooks, contexts, pages (APP)

**✅ APP-1 — high — verified** (direct imports verified; consequences reported).
`src/hooks/useTransactionManager.js:136, 158, 176, 198-251, 273, 285, 303,
321`; `src/pages/TransactionsPage.jsx:31-33, 363, 376, 385, 563, 580`.
Transfers, adjustments, bulk update/delete, confirm and skip call
`services/transactions` directly instead of the `*Offline` wrappers. Dexie is
not updated, `notifyTable` does not fire, balances and reports are not
invalidated, a later refetch can revert the edit on screen, and the actions
throw when offline.
Fix: route them through `*Offline` wrappers; as a stopgap call
`invalidateTable('transactions')` after each.

**✅ APP-2 — high — verified.** `src/contexts/AuthContext.jsx:26-31, 41-42`.
`warmedUp` is reset only when the provider is disabled, never on sign-out, and
sign-out does not reload the page. A second user signing in on the same tab
gets no initial pull, no recurring-cycle init, and an empty Dexie.
Fix: reset `warmedUp.current` when the session becomes null; keep
`startSyncListener` idempotent.

**✅ APP-3 — high — verified.** `src/hooks/queries.js` (most keys),
`src/services/backend.js:175`.
The React Query cache is never cleared on sign-out and most keys carry no user
id. A second user in the same tab sees the first user's cached lists until a
refetch (5 min `staleTime`, 30 min `gcTime`).
Fix: `queryClient.clear()` when the session becomes null or the user id changes.

**✅ APP-4 — high — reported.** `src/contexts/AuthContext.jsx:28-82`,
`src/App.jsx:154`.
The auth effect depends only on `[enabled]`. After a server or backend-mode
change on `/setup`, the listener is still bound to the old client, so the
context session stays null and `/app` ↔ `/auth` can loop.
Fix: remount `AuthProvider` with a key built from origin plus backend mode.

**✅ APP-5 — high — reported.** `src/contexts/ThemeContext.jsx:30-45`,
`src/contexts/SafeModeContext.jsx:44-58`, `src/main.jsx:24-28`.
Theme and safe-mode preferences load once at mount, above `AuthProvider`. On a
cold start at `/auth` the read returns nothing and is not retried after login,
so a user with safe mode on sees real amounts; preferences also carry over
between users.
Fix: key the load on `session?.user?.id` and reset on sign-out.

**✅ APP-6 — medium — reported.** `src/pages/TransactionsPage.jsx:593-596`,
`src/hooks/useTransactionManager.js:271-281`.
`handleConfirm` swallows its own error, so `handleConfirmWithSplit` creates
the split expense even when the confirm failed.
Fix: return success/failure (or rethrow) and split only on success.

**✅ APP-7 — medium — reported.** `src/hooks/queries.js:176-183, 233`.
`useUpcomingTransactions` leaves `endDate` out of its key, so changing
"Project to" on Accounts serves the old list. `useAnnualBudgetData` is keyed
under `budget_plans` but reads `budget_items`, which the bridge does not
invalidate for that key.
Fix: add `endDate` to the key; add the dependency to the bridge.

**✅ APP-8 — medium — reported.** `src/pages/TransactionsPage.jsx:560-574`.
`handleBulkEditSubmit` discards the RPC's returned rows and merges
`{...t, ...rest}`, so the embedded `categories` object keeps the old category.
Fix: use the returned rows as `handleSaveAllEdits` does.

**✅ APP-9 — medium — reported.** `src/pages/TransactionsPage.jsx:357, 441, 609,
1212-1225`; `src/hooks/useSplitNotifications.js:51`; `src/hooks/queries.js:273`.
Split writes from the Transactions page never invalidate `["split_expenses",
…]`. `useSplitNotifications` also fetches the whole table outside React Query
on each mount.
Fix: invalidate after each split write; back the notifications hook with
`useSplitExpenses`.

**APP-10 — medium — reported.** `src/hooks/useTransactionManager.js:126, 153,
172, 188-330`; `src/pages/TransactionsPage.jsx:538-550, 625-628, 845-846`.
Most handlers are recreated every render despite comments calling them stable,
defeating memoised rows in `TransactionList`.
Fix: `useCallback` with functional `setTransactions`; refs for `onError` and
`onDataChanged`.

**✅ APP-11 — medium — reported.** `src/pages/TransactionsPage.jsx:139-148,
891-905`; `src/hooks/useTransactionManager.js:104-114, 332-338`.
Selection is not reset when filters change, so bulk actions can hit hidden
rows. `handleSelectAll` compares only set size.
Fix: intersect `selectedIds` with the visible ids before acting; compare sets.

**✅ APP-12 — medium — reported.** `src/pages/TransactionsPage.jsx:899-902`.
`hasNonPosted` runs `transactions.find` per selected id on every render
(about 9M comparisons with 3,000 rows selected).
Fix: memoise an id-to-status `Map`.

**✅ APP-13 — medium — reported.** `src/pages/AccountsPage.jsx:324, 377, 51-55`.
Account names in the cashflow chips and the negative-balance banner skip
`maskAccountName`. The default projected date is built from UTC parts.
Fix: mask the names; build the date from local parts.

**APP-14 — low — reported.** `src/pages/SettingsPage.jsx:78-88, 248-253`;
`src/pages/TransactionsPage.jsx:93-99, 202-217, 229-235`;
`src/hooks/useThresholds.js:21-49`.
Pages fetch partnership, favourites, templates and thresholds by direct
service calls. In Settings, saving a quick template before `getPartnership()`
resolves overwrites an existing split config with defaults.
Fix: use `usePartnership` and `useUserPreference`; preserve split fields while
the partnership is unloaded.

**APP-15 — low — reported.** `src/pages/ReportsPage.jsx:75-76, 188-193`;
`src/hooks/useRoutePreload.js:57-65`.
Reports waits on queries the visible tab does not need and always runs the
monthly trend query. `useRoutePreload` evaluates chunks with `import()` and
ignores data-saver mode.
Fix: gate on `activeView`; skip preloading in data-saver mode.

---

## Transactions and common UI (UI)

**✅ UI-1 — high — reported.** `src/components/transactions/TransactionForm.jsx:228-232`.
Switching from Transfer to Expense clears `toAccountId` but not
`toAmountForAccount`. The hidden stale value still fails validation and its
error is never shown, so Save does nothing.
Fix: validate the field only when visible; clear it when type or accounts change.

**✅ UI-2 — high — verified** (no validation in `commit` verified; the DB
consequence is reported). `src/components/transactions/TransactionItem.jsx:129-132,
653-656`.
Clearing an inline amount cell queues `amount: 0`; clearing the date queues
`''`. The schema has `CHECK (amount != 0)`, so the batch save fails and every
other pending inline edit is lost with it.
Fix: reject or revert in `EditableCell.commit` when the amount is not above 0
or the date is empty.

**✅ UI-3 — medium — verified.** `src/components/transactions/TransactionFilters.jsx:53-59`.
The search debounce closes over a stale `filters`. A filter changed within
300 ms of typing is silently reverted, and the effect fires once after mount.
Fix: update only `searchText` via a functional update or a ref.

**✅ UI-4 — high — reported.** `src/components/common/Modal.jsx:5-27`.
No `role="dialog"`, `aria-modal`, Escape handling, focus move, focus trap or
focus restore; the close button has no name. `CalculatorModal` already does
this correctly with native `<dialog>`.
Fix: reuse the `<dialog>.showModal()` approach.

**✅ UI-5 — high — verified.** `src/components/transactions/ImportCSV.jsx:175-182`.
`checkDuplicates` results only set a warning; `bulkInsertTransactions` runs
unconditionally and the banner appears after the rows are inserted.
`checkDuplicates` also returns `[]` on query error.
Fix: pause on duplicates and let the user exclude them, or skip them by default.

**✅ UI-6 — medium — reported.** `src/components/transactions/ImportCSV.jsx:122-190`.
`handleCategoryConfirmed` has no try/catch; a thrown error leaves an endless
spinner.
Fix: catch and move to the result step with the error.

**✅ UI-7 — medium — reported.** `src/components/transactions/ImportCSV.jsx:372`.
Error row numbers index the filtered array, so they point at the wrong file
line once rows are excluded; the file-limit error (`rowIndex: -1`) prints "Row 1".
Fix: map back to original indices; special-case `-1`.

**✅ UI-8 — medium — reported.** `src/components/transactions/RecurringGroupForm.jsx:705-716,
872-883`.
Each line item renders a desktop and a mobile `AmountInput`, one hidden by
CSS. An invalid hidden twin blocks native form submit with no visible message.
Fix: render one layout, or add `noValidate` and rely on `validate()`.

**UI-9 — medium — reported.** Keyboard access.
`TransactionList.jsx:208-217` (sort is a click on `<th>`), `:198-204` and
`TransactionItem.jsx:517` (unlabelled checkboxes), `TransactionItem.jsx:241-260`
and `TransactionGroupHeader.jsx:56-75, 348` (portaled kebab menu with no ARIA
or focus handling; unnamed chevron), `FileUploader.jsx:69-87` (drop zone is a
`div` over a hidden input).
Fix: buttons with `aria-sort`, labels, focus management for the menu, and a
`<label>` or `<button>` for the drop zone.

**UI-10 — medium — reported.** Unlabelled form controls.
`TransactionForm.jsx`, `RecurringForm.jsx`, `RecurringGroupForm.jsx`,
`ColumnMapper.jsx` (labels not linked by `htmlFor`), toggle checkboxes
(`TransactionForm.jsx:673-704`, `RecurringForm.jsx:594-602, 646-654`),
`TransactionFilters.jsx`, `MonthYearSelector.jsx:60-83`,
`CategoryMatcher.jsx:241, 327`, `AccountMatcher.jsx:202-212, 244`.
Fix: `htmlFor`/`useId`, `aria-label` on toolbar selects, `aria-pressed` on
segmented buttons.

**◐ UI-11 (partial: inline float maths fixed; CalculatorModal and TransactionItem click-to-edit await the edit-inputs decision) — medium — reported.** Safe-mode and cents bypasses.
`TransactionForm.jsx:621` and `RecurringForm.jsx:388` format money inline with
float maths. `TransactionItem.jsx:649` shows the real amount when a cell is
clicked in safe mode. `CalculatorModal.jsx:104` shows a scrambled result while
applying the real one.
Fix: `formatCurrency(toCents(a) - toCents(b))`; decide and document whether
edit inputs reveal real values in safe mode.

**UI-12 — medium — reported.** `src/components/transactions/CategoryMatcher.jsx:56-88,
292-340`.
Transfer-pair detection is O(n²) and reruns on each assignment change; all
rows (up to 5,000) render with a full category `<select>` each.
Fix: bucket by date and amount, virtualise or paginate, use a category `Map`.

**✅ UI-13 — low — reported.** `src/components/transactions/TransactionForm.jsx:191-197`.
Switching Expense to Income sets the category to the first non-transfer
category, not an income one, so the entry saves as a spending credit.
Fix: keep the category if still valid, else pick one matching the new type.

**✅ UI-14 — low — reported.** `src/components/common/MonthYearSelector.jsx:73-83`,
`TransactionFilters.jsx:113-121`.
The year select can hold a year that is not among its options and then display
the wrong one.
Fix: merge the selected year into the options.

**✅ UI-15 — low — reported.** `src/components/transactions/RecurringGroupForm.jsx:222-251`.
Line items do not check that the linked account differs from the item's account.
Fix: add the check that `RecurringForm` already has.

**✅ UI-16 — low — reported.** `src/components/transactions/ImportCSV.jsx:196`.
The report filename uses the UTC date. Use `getTodayString()`.

---

## Budgets, reports, accounts, splits UI (RPT)

**✅ RPT-1 — high — verified.** `src/components/accounts/AccountForm.jsx:63, 93`.
With safe mode on, editing an account prefills the starting balance from
`toDollars(...)` without `{ raw: true }` (a scrambled value) and submit saves
it over the real balance.
Fix: use `{ raw: true }` for the form value.

**✅ RPT-2 — high — verified.** `src/components/reports/UpcomingRecurring.jsx:143,
157-161`.
"Record Payment" prefills the scrambled amount in safe mode; it differs from
the default, so it is submitted as an override.
Fix: `{ raw: true }` for the prefill.

**✅ RPT-3 — medium — verified.** `src/components/reports/UpcomingRecurring.jsx:158-161`.
Clearing the override field gives `Number('') === 0`, which is passed as
`amountOverride` and recorded as a $0 payment (only `null` means no override,
`src/services/recurring.js:1200`).
Fix: treat empty or non-finite as `null`; reject zero.

**◐ RPT-4 (partial: double scramble removed, but chart shapes kept scrambled rather than built from raw values — owner decision) — medium — reported.** Charts scramble twice in safe mode.
`TrendChart.jsx:26, 43, 76-77, 164, 219`; `CashflowChart.jsx:75, 157, 303`;
`NetWorthChart.jsx:28, 36, 100, 220`; `PlanVsActualChart.jsx:17-18, 29,
109-141`; bar widths in `CategoryChart.jsx:128-131`.
Fix: build chart data with `{ raw: true }` and let the formatters mask once.

**✅ RPT-5 — medium — reported.** Split components format money inline and bypass
safe mode. `BalanceSummary.jsx:3, 21, 26`; `SplitExpenseList.jsx:94-96, 134,
141, 155`; `SettleUpModal.jsx:6, 35, 37`; `SplitExpenseForm.jsx:275, 285, 293,
295`.
Fix: `formatCurrency`.

**✅ RPT-6 — medium — reported.** `src/components/budgets/AnnualBudgetTable.jsx:155-159`.
Unfocused desktop budget inputs show raw amounts in safe mode.
Fix: show `displayDollars` when masked and unfocused.

**✅ RPT-7 — medium — reported.** `src/components/reports/UpcomingRecurring.jsx:83-137`.
`maskAccountName` is called inside a `useMemo` keyed on `[templates]`, so
toggling safe mode does not update the names.
Fix: store raw names; mask at render.

**✅ RPT-8 — medium — reported.** `src/components/accounts/AccountForm.jsx:148`.
The account selector lists real names in safe mode.
Fix: `maskAccountName(a.name)` in the options.

**✅ RPT-9 — medium — reported.** `src/components/reports/CategoryDrillDown.jsx:81, 95`.
The header total adds `Math.abs(amount)` for every row, so refunds and income
debits add instead of subtract and disagree with the parent row.
Fix: sign by classification, as `AnnualActualsTable.jsx:145-149` does.

**✅ RPT-10 — medium — reported.** Group-net logic exists in three diverging
copies: `UpcomingRecurring.jsx:96-101` subtracts outflow transfer children;
`UpcomingRecurring.jsx:318-323` and `RecurringCalendarView.jsx:61-66` skip
transfers.
Fix: one shared helper aligned with `computeGroupNet` in
`src/utils/transactionGrouping.js`.

**✅ RPT-11 — medium — reported.** `src/components/budgets/BudgetForm.jsx:134-172`.
Saving a budget invalidates no query, so Plan vs Actual and the annual table
can stay stale for 5 minutes.
Fix: invalidate as `AnnualBudgetTable.jsx:485-488` does.

**◐ RPT-12 (no delete-before-upsert and correct total; stale categories are zeroed, not deleted — needs a targeted delete in services/budgets.js) — medium — reported.** `src/components/budgets/BudgetImportModal.jsx:162-186`.
Import deletes existing items before upserting, so a failure leaves the month
empty. `total_income` sums every CSV row while items are de-duplicated by
category.
Fix: upsert first, delete only stale items; compute the total from `itemMap`.

**✅ RPT-13 — low — reported.** `src/components/splits/SplitExpenseForm.jsx:42-51, 93-97`.
A custom split accepts a share above the total, giving a negative partner share.
Fix: require both shares to be at least 0.

**✅ RPT-14 — low — reported.** `src/components/accounts/CashflowChart.jsx:109-136`.
"Today" is memoised with `[]` and goes stale past midnight; `setMonth` on the
31st overflows into the next month.
Fix: derive today per render; use date-fns `addMonths`/`subMonths`.

**RPT-15 — low — reported.** `src/components/budgets/AnnualBudgetTable.jsx:327-362,
606-637`; `src/components/reports/AnnualActualsTable.jsx:194-210`.
The whole grid re-renders per keystroke; unmemoised arrays and Sets defeat the
`grouped` memo.
Fix: memoise the derived collections and monthly totals; `React.memo` the row.

---

## Services and utilities (SVC)

**✅ SVC-1 — high — reproduced in Node, not tested in the browser.**
`src/utils/csvParser.js:39`.
`workbook.csv.read(arrayBuffer)` expects a stream. In Node,
`parseSpreadsheetFile` on a `.csv` returns "Failed to parse file: stream.pipe
is not a function". Upload one CSV in the app to confirm before fixing.
Fix: pass a stream, or parse CSV text directly.

**✅ SVC-2 — high — verified (reproduced).** `src/utils/csvParser.js:298-351`.
`normalizeAmount("$-12.50")` returns `cents: -1250, isNegative: false`, so the
row imports as negative income. `"12/05/2024"` in an amount column returns
1200. Numeric cells skip the cap and NaN check.
Fix: handle the sign after stripping symbols; validate with a strict numeric
regex; reject negative or non-finite cents; apply the cap on both paths.

**✅ SVC-3 — high — reported** (reviewer ran it with `TZ=Australia/Sydney`).
`src/utils/csvParser.js:291-293, 355-361`.
The `new Date(str)` fallback parses local midnight but `formatISODate` reads
UTC parts, so dates shift a day earlier east of UTC. exceljs CSV dates are
also local-midnight; xlsx dates are UTC.
Fix: format from captured components; use local getters for locally parsed dates.

**✅ SVC-4 — medium — reported.** `src/utils/csvParser.js:266, 282`;
`src/services/import.js:153-162, 491-501`.
Impossible dates (`2024-02-31`) pass validation and fail the whole 100-row
batch. Rows can carry null `category_id` or `account_id`. Transfer legs can
land in different batches, leaving an orphan leg if one batch fails.
Fix: validate real dates, require both ids, keep pairs in one batch.

**✅ SVC-5 — medium — reported.** `src/services/recurring.js:1107-1160` (with
580-592).
A split template with a linked account creates two split expenses per
occurrence, because both legs share the template id and pass the filter. The
split uses the template amount, not the transaction's.
Fix: restrict to the main leg; use the transaction's amount.

**✅ SVC-6 — medium — reported.** `src/services/recurring.js:890-892` with
`383-392, 441-457`.
If a generation run is in flight, an edit's regeneration call returns the
in-flight promise; its stale snapshot does not recreate the cleared rows, so
the edited template has no projections until the next init.
Fix: queue a second run after the first.

**◐ SVC-7 (not fixed: manual future payments are indistinguishable from projections without a schema change or a product rule) — medium — reported.** `src/services/recurring.js:1175-1195, 1271-1285`.
A manual payment dated in the future is treated as an orphan projection by
`cleanupOrphanedProjections` and soft-deleted on next startup.
Fix: exclude manually recorded rows from orphan cleanup.

**✅ SVC-8 — medium — reported.** `src/services/export.js:281-293, 187-188`.
Budget-history "Actual" adds `Math.abs` for every non-transfer row, ignoring
refunds, income debits and status. The Type column labels spending credits
"Income".
Fix: use the classification helpers and filter to posted rows.

**✅ SVC-9 — medium — reported.** `src/services/export.js:123-160`.
The "full backup" filters accounts, categories and templates to `is_active`,
leaving dangling ids on exported transactions; split expenses and partnerships
are not exported.
Fix: drop the filter for the backup and include the missing tables, or label
the file as partial.

**✅ SVC-10 — medium — reported.** `src/utils/helpers.js:341, 370`.
The budget CSV parser splits on every comma, ignoring quoting, so `"$1,234"`
breaks the row. `headerToMonthIndex` matches any header with a month prefix
("Marketing" → March).
Fix: use a real CSV tokenizer; match month names exactly.

**SVC-11 — medium — reported.** `src/services/auth/localAuthAdapter.js:31, 54,
93-98, 108-111`.
A 429 or 5xx on refresh is rethrown even while the current access token is
still valid, failing every request; the refresh timer is not re-armed.
`toSessionError` returns the previously stored session with a sign-in error.
Fix: fall back to the unexpired token and retry with backoff; return
`session: null` on sign-in errors.

**✅ SVC-12 — medium — reported.** `src/services/transactions.js:714-731, 789-834`.
`deleteTransaction` only logs a failed companion delete and still deletes the
original. `skipTransaction` and `confirmTransaction` act on one leg of a pair.
Fix: resolve `transfer_group_id` companions in skip and confirm; throw on a
failed companion delete.

**◐ SVC-13 (partial: UUID fallback done everywhere via src/utils/ids.js; navigator.locks refresh lock not done) — medium — reported.** `src/services/recurring.js:489, 563`;
`transactions.js:173, 223, 496`; `import.js:467`; `quickTransactions.js:23`.
`crypto.randomUUID()` and `navigator.locks` do not exist on plain-http
non-localhost origins, which `docs/SETUP_GUIDE.md:532` documents. Transfers
throw, and two tabs can reuse a rotated refresh token (see INF-4).
Fix: add a `crypto.getRandomValues` UUID fallback and a localStorage refresh lock.

**SVC-14 — low — reported.** `src/services/import.js:178-305, 425-435, 549-551`.
Auto-categorisation uses substring matching ("rent" in "Current"), the fuzzy
fallback can pick transfer categories, `checkDuplicates` is O(n×m), and the
report CSV does not escape quotes or formula prefixes.
Fix: word-boundary matching, exclude transfer categories, index by
`date|amount`, escape the report.

**✅ SVC-15 — low — reported.** `src/utils/connectionErrors.js:17`.
`Object.hasOwn(navigator, 'onLine')` is always false, so the device-offline
message never shows.
Fix: `'onLine' in navigator`.

**✅ SVC-16 — low — reported.** `src/utils/recurringCalculations.js`,
`getOccurrencesInRange`.
`maxOccurrences = 50` truncates 1-day custom templates to 50 of the 90
projection days.

---

## Database (DB)

Checked and found sound: RLS enabled with policies on all nine public tables;
the soft-delete `USING`/`WITH CHECK` rule on `transactions` and
`split_expenses`; the three `SECURITY DEFINER` functions pin `search_path` and
use `auth.uid()`; every `.rpc()` call in `src/services` matches SQL names and
arguments; `local/apply_order.txt` order is valid; money columns are BIGINT cents.

**✅ DB-1 — high — verified.** `sql_scripts/supabase_split_expenses.sql:56-73`
(same in `supabase_rls_complete.sql:137-154`).
Partnership INSERT only requires `user_a_id = auth.uid()`, so a user can insert
`status='active'` with any `user_b_id`. UPDATE `WITH CHECK` lets either member
reactivate a dissolved row or rewrite member ids and `invited_email`. Only the
pair is unique, so a victim in two active partnerships breaks
`getPartnership()`'s `.maybeSingle()` (`src/services/partnerships.js:8-17`).
Fix: INSERT requires `status='pending' AND user_b_id IS NULL`; do accept and
dissolve through an RPC or a BEFORE UPDATE trigger that freezes identity
columns and allows only valid transitions; add a unique index on active
membership per user.

**✅ DB-2 — medium — reported.** `supabase_split_expenses.sql:128-136`
(`supabase_rls_complete.sql:183-192`).
split_expenses INSERT checks membership only: `paid_by_user_id` need not be a
partner, and `transaction_id` can reference another user's transaction.
Fix: check both in `WITH CHECK` or a trigger.

**DB-3 — medium — reported.** `supabase_schema_create.sql:36`.
`UNIQUE (user_id, name, is_active)` fails on the second soft-delete of a
category with the same name.
Fix: partial unique index on `(user_id, name) WHERE is_active`, with a
migration and a DATA_MODEL update.

**DB-4 — medium — reported.** `supabase_phase4_mutations.sql:73-76, 114-128`;
`supabase_schema_create.sql:185-187, 280-282`.
`assert_account_open` is BEFORE INSERT only, so updates can move a transaction
to a closed account. Ownership of referenced `account_id`/`category_id` is
never checked.
Fix: trigger on INSERT OR UPDATE OF `account_id`, and verify the referenced
rows belong to `NEW.user_id`.

**DB-5 — low — reported.** `supabase_phase4_mutations.sql:260-289, 299-373`.
`upsert_recurring_group` does not raise when the parent UPDATE matches no row,
so children can be inserted under a parent the caller does not own.
Fix: `IF NOT FOUND THEN RAISE`.

**DB-6 — low — reported.** `supabase_schema_create.sql:135, 167`.
`transactions.is_income` and `accounts.starting_balance` are nullable; a NULL
drops the row from totals or makes the balance NULL. `recurring_templates.amount`
lacks the `<> 0` check.
Fix: `NOT NULL DEFAULT` with backfill and migration; add the check.

**DB-7 — low — reported.** `supabase_split_expenses.sql:186`.
`get_partner_email` uses unqualified `partnerships` with `search_path = public`.
Fix: `SET search_path = public, pg_temp` and qualify the table.

**DB-8 — low — reported.** `supabase_category_archiving.sql:133`,
`supabase_split_expenses.sql:192`, phase3/phase4 functions.
Execute privileges differ between Supabase (anon keeps EXECUTE) and local.
Fix: `REVOKE ... FROM PUBLIC, anon` and `GRANT ... TO authenticated` on each RPC.

**DB-9 — low — reported, possibly intended.** `supabase_split_fix_rls.sql:44-53`,
`supabase_rls_complete.sql:217-227`.
After a partnership is dissolved, either ex-member can still edit and
hard-delete shared split expenses.

**DB-10 — low — reported.** `supabase_add_updated_at.sql:45-58`.
`updated_at` triggers exist only on categories, budget_items and
recurring_templates; the other four synced tables rely on the client clock,
which the sync watermark depends on (see OFF-11).
Fix: attach `set_updated_at` to transactions, accounts, budget_plans and
user_preferences.

**DB-11 — low — reported.** `supabase_rls_complete.sql:134, 148`.
Partnership policies cast `request.jwt.claims` directly; no lowercase check on
`invited_email`.
Fix: use `auth.email()`; add `CHECK (invited_email = lower(invited_email))`.

**DB-12 — low — reported.** `sql_scripts/migrations/`.
No migrations exist for several columns now in the base scripts
(`transactions.status`, `recurring_template_id`, `transfer_group_id`, the
recurring group columns). `supabase_rls_complete.sql:49` references a
nonexistent file. `local/tests/` covers only transactions RLS.
Fix: state a minimum baseline or add a catch-up migration; add partnership and
split RLS tests.

**DB-13 — low — reported.** `supabase_phase3_aggregations.sql:281, 355, 393`;
`supabase_schema_create.sql:132-139, 222-226`; `supabase_split_expenses.sql:114`.
`get_net_worth_history` joins on a non-sargable `date_trunc` and computes its
CTE twice. Several indexes are unused or duplicated.
Fix: filter by date range per month; drop the redundant indexes.

---

## Auth service, containers, nginx, CI (INF)

**✅ INF-1 — high — verified.** `nginx.conf:40-90`.
`/sw.js`, `/manifest.webmanifest`, `/env-config.js`, `/assets/`, `/workbox-`
and `/index.html` each set `add_header`, which discards the server-level
security-headers include. The HTML document is served without CSP, HSTS or
`X-Frame-Options`.
Fix: re-include `/etc/nginx/snippets/security-headers.conf` in each of those
locations; assert the CSP header on `/` in `scripts/test-selfhost.test.js`.

**✅ INF-2 — high — reported** (config verified, exploit not run).
`server/auth/src/config.js:18`, `nginx/local-proxy.conf.template:9-24`.
`trustProxy` defaults to true and nginx appends to the client's
`X-Forwarded-For`, so a client can likely spoof its IP and bypass the per-IP
rate limits on signup, token and password.
Fix: `proxy_set_header X-Forwarded-For $remote_addr`; set `trustProxy` to a
hop count or CIDR.

**INF-3 — medium — reported.** `server/auth/src/app.js:44-53, 220-232`.
Five wrong passwords lock an email for 15 minutes for everyone, so anyone can
lock out any account. Concurrent requests pass the check before failures are
recorded.
Fix: key by (email, IP) or use progressive delay; count before the bcrypt await.

**INF-4 — medium — reported.** `server/auth/src/app.js:239-262`.
Refresh-token reuse revokes the whole family with no grace window, so two tabs
or a retried refresh sign the user out everywhere.
Fix: allow a short reuse window.

**INF-5 — medium — reported.** `vite.config.js:98-164`,
`src/services/backend.js:189-190`.
Authenticated `/rest/v1` responses are runtime-cached by URL only and purged
only by `signOut`. The purge also deletes every `workbox-` cache, including
the precache, so the app shell is gone for the next offline launch.
Fix: purge on any session clear, delete only the two named runtime caches,
and consider not runtime-caching `/rest/v1`.

**INF-6 — medium — reported.** `vite.config.js:89-92`, `public/env-config.js`,
`index.html:21`.
`/env-config.js` is NetworkOnly. On a cold offline start a self-hosted PWA
loses its config and lands on the server-setup screen.
Fix: NetworkFirst with a short timeout, or persist the last good values.

**INF-7 — medium — reported.** `server/auth/src/index.js:11`.
The pg Pool has no `'error'` listener; a database restart crashes the process.
Fix: `pool.on('error', …)`.

**INF-8 — medium — verified in part** (no workflow runs tests).
`.github/workflows/docker-publish.yml:22-37`, `security.yml`.
CI runs lint and `npm audit` only: no `npm test`, no auth-service tests, no
audit of `server/auth`. The release job tags before images build. Scout scans
one of three images. `security.yml` has no `permissions` block. CI uses
Node 24, images use Node 22.
Fix: add `npm test` and an auth job with a Postgres service container; tag
after build; scan all images.

**INF-9 — medium — reported, uncertain.** `docker-compose.yml:12-13`.
The healthcheck uses `curl`, which `nginx:stable-alpine-slim` probably lacks.
Fix: `wget -q --spider`.

**INF-10 — medium — reported.** `nginx/local-proxy.conf.template:6, 20`.
Upstream names resolve once at startup; recreating `auth` or `postgrest`
alone gives 502 until the app container restarts.
Fix: `resolver 127.0.0.11 valid=10s;` with a variable in `proxy_pass`.

**INF-11 — low — reported.** `server/auth/src/app.js:24, 214, 228`.
Signup returns 409 for existing emails. Migrated cost-10 hashes are faster
than the cost-12 dummy and are never rehashed.
Fix: rehash on successful login.

**INF-12 — low — reported.** `scripts/test-selfhost.test.js:38-39`,
`docker-compose.selfhost.yml`, Dockerfiles.
Anonymous `GET /rest/v1/` exposes the OpenAPI schema. No service sets
`read_only`, `cap_drop`, `no-new-privileges` or limits; the app image runs as
root; the auth image skips `apk upgrade`; images are unpinned.
Fix: `PGRST_OPENAPI_MODE: disabled` and container hardening options.

**INF-13 — low — reported.** `server/auth/src/app.js:126-133`,
`server/auth/src/config.js:1-4`.
Expired and revoked refresh tokens are never deleted. `parseInt` config
parsing turns `15m` into 15 seconds and accepts zero or negative values.
Fix: periodic purge; validate ranges.

**INF-14 — low — reported.** Test quality.
`server/auth/test/helpers.js:5-25` hand-copies the auth schema.
`scripts/helpers.test.js:36-58` tests `Date` rather than an app function.
`scripts/recurring-cleanup.test.js:137-139` greps source text and indexes mock
calls by position. No tests cover expired tokens, concurrent refresh, headers
or CSP.

**◐ INF-15 (partial: only the add_header-in-if part (fixed with INF-1)) — low — reported.** `nginx.conf:56-71`, `docker-entrypoint.sh:35-37`.
`add_header` inside `if` drops `no-store` on `/env-config.js` for native
origins. The entrypoint `sed` breaks on `|`, `&` or `\` in `SUPABASE_URL`. The
supabase-mode CSP hardcodes `*.supabase.co`. No `limit_req` on the proxies.
