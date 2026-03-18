# Phase 3: Advanced Features - CSV Import & Offline Support (Weeks 3-4)

## 📍 Current Status

**Phase 2 Complete** ✅

- ✅ Budget planning works
- ✅ Plan vs Actual visualization shows
- ✅ Alerts warn users
- ✅ Users see spending trends

**Current Phase**: Phase 3 - CSV Import + Offline Support

---

## 🎯 Phase 3 Goals

**By the end of Phase 3, users can:**

1. Import transactions from Excel/CSV files
2. Work offline (transactions sync when online)
3. Set up recurring transactions automatically
4. Get bill reminders
5. Export their data (backup/analysis)

---

## 📋 Phase 3 Features (Choose 1-2 to Start)

### Feature 1: CSV Import (2-3 hours)

**Goal**: Users can bulk-import transactions from Excel/CSV, matching them to categories automatically.

#### User Story

```
As a user, I want to:
- Upload my Excel budget spreadsheet
- Map columns to transaction fields
- Auto-detect categories based on description
- Import all at once instead of manually entering
```

#### Data Model Reference

From [DATA_MODEL.md](./DATA_MODEL.md):

- transactions table: amount, description, transaction_date, category_id, is_income

#### AI Context Pattern

```
Create a CSV import component using React + SheetJS.

Library: sheetjs (npm install xlsx)
Data model (from DATA_MODEL.md):
- transactions: user_id, category_id, amount (cents),
  description, transaction_date, is_income

Feature workflow:
1. File input: User selects CSV/Excel file
2. Preview: Show first 5 rows of file
3. Column mapping:
   - User selects which spreadsheet column = amount, date, description
   - Show preview of mapped data
4. Category matching:
   - For each transaction, try to auto-match to existing category
   - Allow manual override before importing
5. Import:
   - Create transactions in bulk
   - Show success/error count
   - Allow download of import report

File format expected:
- CSV or Excel (.xlsx/.xls)
- Columns: Date, Description, Amount (can be in any order)
- Dates: Any common format (MM/DD/YYYY, YYYY-MM-DD, etc.)
- Amounts: Can be negative (expense) or positive (income)

Validation:
- Dates must be valid
- Amounts must be numeric
- At least one transaction per file
- No duplicates (warn if similar date+amount exists)

Use utils/helpers.js for date/currency conversion
Use Supabase for bulk insert
Use Tailwind for UI.
```

#### Files to Create

- `src/components/transactions/ImportCSV.jsx` - Main import wizard
- `src/components/transactions/FileUploader.jsx` - File input
- `src/components/transactions/ColumnMapper.jsx` - Column selection
- `src/components/transactions/CategoryMatcher.jsx` - Auto-category logic
- `src/services/import.js` - Import logic and validation
- `src/utils/csvParser.js` - Parse CSV/Excel files

#### Success Criteria

- [ ] User can upload CSV/Excel file
- [ ] Preview shows correctly mapped columns
- [ ] Auto-categorization works (matches description to category)
- [ ] Can manually edit category before importing
- [ ] Bulk import completes in < 5 seconds (for 100 transactions)
- [ ] Shows count of successful imports
- [ ] Shows errors clearly (duplicate date, invalid amount, etc.)

---

### Feature 2: Offline Support with Sync (3-4 hours)

**Goal**: App works offline. Transactions sync to server when online.

#### Why This Matters

- User adds transaction on airplane
- App saves locally to IndexedDB
- Lands, connects to WiFi
- Transaction syncs automatically
- No data loss, seamless experience

#### Data Model Reference

We'll use **Dexie.js** (IndexedDB wrapper) alongside Supabase.

Mirror these tables in IndexedDB (from [DATA_MODEL.md](./DATA_MODEL.md)):

- `transactions` — includes `account_id` (NOT NULL), `payee`, `status` ('projected'|'pending'|'posted'), `transfer_group_id`, `recurring_template_id`, `deleted_at` (soft deletes)
- `categories` — includes `sort_order`, `is_active`
- `budget_items`
- `budget_plans`
- `accounts` — asset/liability accounts; required for transaction creation
- `user_preferences` — per-user UI preferences (e.g., `type_group_order`)
- `recurring_templates` — includes `account_id`, `payee`, `is_transfer`, `to_account_id`, grouping fields (`group_id`, `is_group_parent`, `group_order`), `auto_confirm`, `projected_through`

#### AI Context Pattern

```
Create offline support using Dexie.js + IndexedDB sync.

Already installed: dexie

Data model (from DATA_MODEL.md):
- All monetary values stored as integers (cents)
- transactions: id, user_id, account_id (NOT NULL), category_id, amount (cents),
  description, payee, transaction_date, is_income, transfer_group_id,
  status ('projected'|'pending'|'posted'), recurring_template_id,
  created_at, updated_at, deleted_at (soft deletes — set deleted_at, don't remove row)
- categories: id, user_id, name, type, color, icon, is_active, sort_order, created_at
- budget_plans: id, user_id, month, year, name, total_income, created_at, updated_at
- budget_items: id, budget_plan_id, category_id, planned_amount, notes
- accounts: id, user_id, name, type ('checking'|'savings'|'credit_card'|'retirement'|'brokerage'|'loan'|'mortgage'),
  starting_balance, is_active, created_at, updated_at
- user_preferences: id, user_id, preference_key, preference_value (JSONB), created_at, updated_at
- recurring_templates: id, user_id, account_id, category_id, description, payee, amount,
  is_income, is_transfer, to_account_id, frequency ('weekly'|'biweekly'|'semi_monthly'|'monthly'|'quarterly'|'yearly'),
  day_of_month, day_of_month_2 (semi_monthly only), day_of_week, start_date, end_date,
  last_applied, group_id, is_group_parent, group_order, auto_confirm, projected_through,
  is_active, created_at

Architecture:
1. Create Dexie database mirroring Supabase schema (same field names, same types)
2. When online: All writes go to Supabase + IndexedDB (dual-write)
3. When offline: Writes go to IndexedDB only
4. When coming online: Sync IndexedDB to Supabase

Dexie setup (src/services/offlineDb.js):
- Create tables: transactions, categories, budget_items, budget_plans,
  accounts, user_preferences, recurring_templates
- Each table mirrors Supabase schema (same field names)
- For transactions: respect soft-delete pattern (set deleted_at, never remove row)
- For accounts: needed before creating transactions (account_id is NOT NULL)

Sync logic (src/services/sync.js):
- Detect online/offline state (navigator.onLine)
- On coming online: Fetch all offline-created/updated data
- Batch insert to Supabase (use pagination — Supabase max 1000 rows per request)
- Use `transfer_group_id` to sync both legs of a transfer atomically
- Clear/update IndexedDB after successful sync
- Show user: "Syncing... X transactions"

UI changes:
- Show offline indicator in header
- Show "queued for sync" badge on offline transactions
- Show sync status: "3 transactions pending upload"

Handle conflicts:
- If user deletes online and creates offline: last-write-wins
- Respect soft-delete: offline deletes set deleted_at, not a hard remove
- Recurring template projected transactions: re-check dedup on sync
  (DB has a unique partial index on recurring_template_id + transaction_date + account_id)
- Log conflicts for debugging

Use Dexie docs: https://dexie.org
```

#### Files to Create

- `src/services/offlineDb.js` - Dexie database setup
- `src/services/sync.js` - Sync logic and conflict resolution
- `src/hooks/useOnlineStatus.js` - Detect online/offline
- `src/hooks/useSyncStatus.js` - Track pending syncs
- `src/components/common/SyncStatus.jsx` - Status indicator
- `src/utils/syncQueue.js` - Queue offline changes

#### Success Criteria

- [ ] App works offline (can view data)
- [ ] Can add transactions while offline
- [ ] Transactions stored in IndexedDB when offline
- [ ] When online, syncs automatically
- [ ] Shows "pending sync" indicator
- [ ] No data loss after sync
- [ ] Handles network disconnections gracefully

---

### Feature 3: Recurring Transactions (2-3 hours)

**Goal**: Automatically create monthly subscriptions, rent, etc.

#### User Story

```
As a user, I want to:
- Create a recurring transaction (e.g., rent every 1st of month)
- Have it auto-apply monthly
- Modify or cancel recurring transaction
- See all upcoming recurring charges
```

#### Data Model Reference

From [DATA_MODEL.md](./DATA_MODEL.md):

- recurring_templates table (Phase 2 addition)

#### AI Context Pattern

```
Create recurring transaction functionality.

Data model (from DATA_MODEL.md):
- recurring_templates table:
  - frequency ('monthly', 'weekly', 'quarterly', 'yearly', 'biweekly')
  - day_of_month (1-31) or day_of_week (0-6)
  - start_date, end_date
  - amount, category_id, description

Features:
1. Create template UI:
   - Frequency dropdown (monthly, weekly, quarterly, yearly)
   - Day selector (calendar picker or number input)
   - Amount, description, category
   - Start/end dates

2. Auto-apply logic (background job or on app startup):
   - Check if today is apply day
   - Create transaction if not created yet
   - Update last_applied date

3. Display:
   - List of upcoming recurring charges
   - Show next 3 months of scheduled charges
   - Edit/delete recurring template

4. Integration with existing UI:
   - Show "Upcoming" section in dashboard
   - Prefill form when creating recurring transaction

Use Supabase for storage
Use date-fns for date calculations
Use Tailwind for UI
```

#### Files to Create

- `src/components/transactions/RecurringForm.jsx` - Create template
- `src/components/reports/UpcomingRecurring.jsx` - Show upcoming
- `src/services/recurring.js` - Template CRUD + apply logic
- `src/utils/recurringCalculations.js` - Date math (next occurrence, etc.)

#### Success Criteria

- [ ] User can create recurring transaction (monthly rent, $1200)
- [ ] Template saves to Supabase
- [ ] "Apply recurring" creates transaction automatically
- [ ] Dashboard shows upcoming recurring charges
- [ ] Can edit/delete recurring template
- [ ] Handles edge cases (Feb 30th → March 2nd, etc.)

---

### Feature 4: Data Export & Backup (1-2 hours)

**Goal**: Users can export their data for backup or analysis.

#### AI Context Pattern

```
Create data export functionality.

User can export:
1. All transactions (CSV for Excel)
2. Budget history (CSV)
3. Full backup (JSON with all data)

Export format:
- CSV: Transactions with columns (Date, Description, Category, Amount)
- CSV: Monthly budgets with actual amounts
- JSON: Full backup of all tables

Files to create:
- Transactions export as CSV using SheetJS
- Budget summary as CSV
- Full JSON backup (human-readable)

UI:
- Button in settings/dashboard
- Select what to export
- Click "Download" → file downloads

Use SheetJS for CSV generation
Use JSON.stringify for JSON export
```

#### Files to Create

- `src/components/common/ExportData.jsx` - Export UI
- `src/services/export.js` - Export logic
- `src/pages/SettingsPage.jsx` - Settings/export options

#### Success Criteria

- [ ] User can download transactions as CSV
- [ ] CSV opens correctly in Excel
- [ ] Column headers are clear
- [ ] Full JSON backup works
- [ ] Download file has proper name (budget-backup-2026-02-27.json)

---

## 🛠️ Recommended Build Order for Phase 3

**If time is limited: Do CSV Import only** (highest user value)

1. **CSV Import** (2-3 hours) ← Start here
   - Users can bulk-import their Excel data
   - Huge time-saver vs manual entry
   - Makes app instantly useful

2. **Data Export** (1-2 hours)
   - Quick to add, high value
   - Users feel confidence in data safety

3. **Offline Support** (3-4 hours)
   - More complex, requires Dexie.js
   - Nice-to-have but not critical

4. **Recurring Transactions** (2-3 hours)
   - Useful but can wait for Phase 4
   - Requires more complex date math

---

## 📊 Common Phase 3 Issues & Solutions

### CSV Import Issues

**Problem: Amounts importing as strings**

```
Solution: Parse as float before converting to cents
const amount = parseFloat(row.Amount);
const cents = toCents(amount);
```

**Problem: Dates in wrong format**

```
Solution: Use date-fns to parse flexible formats
import { parse } from 'date-fns';
const date = parse(row.Date, 'MM/dd/yyyy', new Date());
```

**Problem: Duplicate detection**

```
Solution: Check for similar transactions in last 7 days
const isDuplicate = await checkDuplicateTransaction(date, amount, description);
```

### Offline Issues

**Problem: Sync creates duplicates**

```
Solution: Use idempotency keys (same offline transaction = same creation)
const offlineId = uuid(); // Apply same ID on sync
```

**Problem: IndexedDB limits (~50MB)**

```
Solution: Only cache last 6 months of transactions locally
```

**Problem: Network status flaky**

```
Solution: Implement retry logic with exponential backoff
```

---

## 🎓 Learning Goals for Phase 3

By end of Phase 3, you'll understand:

- ✅ File parsing and validation (CSV/Excel)
- ✅ Offline-first architecture with sync
- ✅ Background tasks (applying recurring transactions)
- ✅ Data import/export patterns
- ✅ Bulk operations in Supabase
- ✅ IndexedDB caching strategies

---

## 📚 Reference Documentation

- [SheetJS Docs](https://sheetjs.com)
- [Dexie.js Docs](https://dexie.org)
- [date-fns Docs](https://date-fns.org)
- [Supabase Bulk Operations](https://supabase.com/docs/reference/javascript/insert)

---

## 🎯 End of Phase 3 Goal

**Ship Phase 3 MVP**:

- ✅ CSV import works (100 transactions in 5 seconds)
- ✅ Data export as CSV/JSON
- ✅ (Stretch) Offline support with sync
- ✅ (Stretch) Recurring transactions

**New user flow**:

```
1. Sign up
2. Import Excel spreadsheet (500 historical transactions in 30 sec)
3. Adjust budget
4. See dashboard with real data
5. Add new transaction manually
6. Works offline
7. Exports data for backup
```

---

## 🚀 Success Looks Like

After Phase 3, your app:

- ✅ Has all core features working
- ✅ Handles real user workflows
- ✅ Works without internet
- ✅ Can import real data from Excel
- ✅ Is genuinely useful to you and friends

**You're ready to deploy publicly and iterate based on feedback.**

---

**Phase 3 Guide Version**: 1.0  
**Last Updated**: February 27, 2026
