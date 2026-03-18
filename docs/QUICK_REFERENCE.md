# 📖 Documentation Navigation Guide

**Lost? Use this to find what you need.**

---

## � Documentation Files

```
CONTEXT_GUIDE.md        ← How to work with AI effectively
DATA_MODEL.md           ← Database schema (reference while coding)
SECURITY.md             ← Security model and invariants
SECURITY_CHECKLIST.md   ← Pre-merge security review checklist
SETUP_GUIDE.md          ← Supabase setup walkthrough
STYLE_GUIDE.md          ← Design system, component patterns, dark mode
QUICK_REFERENCE.md      ← This file
archive/                ← Completed phase build guides (historical)
```

---

## 🚀 Just Starting?

1. **New to the project?** → [README.md](../README.md) (project overview)
2. **Need to set up Supabase?** → [SETUP_GUIDE.md](./SETUP_GUIDE.md)

---

## 📋 By Task

### "I'm setting up the project for the first time"

→ [SETUP_GUIDE.md](./SETUP_GUIDE.md)

- Supabase account & project creation
- Environment variables (`.env`)
- Database migration (`sql_scripts/supabase_schema_create.sql` + optional `sql_scripts/supabase_split_expenses.sql`)
- Default data setup, troubleshooting

### "I'm designing or querying the database"

→ [DATA_MODEL.md](./DATA_MODEL.md)

- Complete schema: 7 core tables + optional split-expense extension tables (`partnerships`, `split_expenses`)
- TypeScript interfaces
- SQL migration scripts
- Key design decisions (cents storage, soft deletes, RLS, 1000-row pagination)

### "I'm building a new component or page"

→ [STYLE_GUIDE.md](./STYLE_GUIDE.md)

- Color palette (warm stone, amber, teal)
- Typography and spacing
- Button, form, card, table, alert patterns
- Page layout template and navigation rules
- Dark mode color mapping table
- `useMonthYear` context pattern

### "I need to ask AI for code"

→ [CONTEXT_GUIDE.md](./CONTEXT_GUIDE.md)

- Good vs bad prompts, avoiding hallucinations
- Context management patterns

### "I want the big picture"

→ [README.md](../README.md)

- Full feature list
- Tech stack
- Project structure

### "I'm stuck on Supabase setup"

→ [SETUP_GUIDE.md](./SETUP_GUIDE.md)

- Account creation, environment variables, migrations, troubleshooting

### "I need a quick reference"

→ [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) (you are here)

---

## 📁 Key Files in Project

### Documentation Files

```
CONTEXT_GUIDE.md        ← How to work with AI effectively
DATA_MODEL.md           ← Database schema and TypeScript types
SECURITY.md             ← Security model and invariants
SECURITY_CHECKLIST.md   ← Pre-merge security review checklist
SETUP_GUIDE.md          ← Supabase setup walkthrough
STYLE_GUIDE.md          ← Design system, component patterns, dark mode
QUICK_REFERENCE.md      ← This file
archive/                ← Completed phase build guides (historical)
```

### Source Code (`src/`)

```
src/
├── App.jsx                     ← App routes, auth guard, recurring + sync init
├── pages/
│   ├── ReportsPage.jsx         ← Reports: Summary, Plan vs Actual, Trends, Annual Actuals
│   ├── TransactionsPage.jsx    ← Transaction list, filters, CSV import
│   ├── BudgetPage.jsx          ← Monthly budget + annual budget table
│   ├── SplitExpensesPage.jsx   ← Shared expense split setup, tracking, settlement
│   ├── AccountsPage.jsx        ← Account list, net worth chart/summary
│   ├── CategoriesPage.jsx      ← Category management with drag-and-drop
│   ├── SettingsPage.jsx        ← Theme, preferences
│   └── AuthPage.jsx            ← Login / signup
├── components/
│   ├── accounts/               ← AccountForm, AccountList, NetWorthChart, NetWorthSummary
│   ├── budgets/                ← BudgetForm, CategoryList, AnnualBudgetTable, BudgetImportModal
│   ├── reports/                ← CategoryChart, CategoryComparison, CategoryDrillDown, PlanVsActual, AnnualActualsTable, …
│   ├── splits/                 ← Shared expense split setup, tracking, settlement views
│   ├── transactions/           ← Transaction list/form/filters, recurring form & group form
│   └── common/                 ← Modal, TopBar, MonthYearSelector, SyncStatus, ExportData, BudgetAlert, ProtectedRoute
├── services/
│   ├── supabase.js             ← Client init
│   ├── transactions.js         ← CRUD + pagination loop
│   ├── budgets.js              ← Plans, items, plan-vs-actual
│   ├── accounts.js             ← CRUD + balance calculation
│   ├── categories.js           ← CRUD + bulkUpdateSortOrder
│   ├── recurring.js            ← Template CRUD + projection engine + concurrency guard
│   ├── splitExpenses.js        ← Split expense CRUD + partner balance logic
│   ├── partnerships.js         ← Partner invite/accept/dissolve lifecycle
│   ├── import.js               ← CSV parsing, column mapping, duplicate detection
│   ├── export.js               ← Excel workbook generation
│   ├── analytics.js            ← Multi-month trend analysis
│   ├── offlineDb.js            ← Dexie schema + IndexedDB helpers
│   ├── sync.js                 ← Sync queue + last-write-wins conflict resolution
│   └── offlineAware.js         ← Routes writes to offline DB when offline
├── hooks/
│   ├── useMonthYear.js         ← Shared month/year context (use this, not useState)
│   ├── useTheme.js             ← isDark + toggleTheme()
│   ├── useOnlineStatus.js      ← navigator.onLine + event listeners
│   ├── useSyncStatus.js        ← Pending sync count
│   └── useTransactionManager.js← Offline-aware transaction CRUD
└── utils/
    ├── helpers.js              ← formatCurrency, formatDate, etc.
    ├── budgetCalculations.js
    ├── recurringCalculations.js← Date math for recurring schedules
    ├── csvParser.js
    └── syncQueue.js
```

### Configuration Files

```
.env.example        ← Copy to .env and add Supabase credentials
vite.config.js      ← Vite configuration
tailwind.config.js  ← Tailwind CSS config
postcss.config.js   ← PostCSS config
package.json        ← Dependencies
```

---

## 🎯 By Information Type

### For Coding

- [DATA_MODEL.md](./DATA_MODEL.md) — schema, TypeScript types, common queries
- [STYLE_GUIDE.md](./STYLE_GUIDE.md) — component patterns, dark mode

### For AI Assistance

- [CONTEXT_GUIDE.md](./CONTEXT_GUIDE.md) — how to write effective prompts

### For Setup / Onboarding

- [SETUP_GUIDE.md](./SETUP_GUIDE.md) — initial setup
- Root [README.md](../README.md) — project overview and feature list

### For Security Review

- [SECURITY.md](./SECURITY.md) — model and invariants
- [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) — per-PR checklist

---

## 🔍 Quick Lookup

### Where to find…

**Authentication code?**

- Components: `src/components/common/LoginForm.jsx`, `SignupForm.jsx`
- Auth model: Supabase Auth (`auth.users`)
- App-owned schema: [DATA_MODEL.md](./DATA_MODEL.md) → `user_preferences`, user-owned domain tables

**Transaction logic?**

- CRUD: `src/services/transactions.js`
- Schema: [DATA_MODEL.md](./DATA_MODEL.md) → transactions table
- Offline-aware wrapper: `src/services/offlineAware.js`

**Budget planning?**

- Service: `src/services/budgets.js`
- Schema: [DATA_MODEL.md](./DATA_MODEL.md) → budget_plans, budget_items tables
- Annual view: `src/components/budgets/AnnualBudgetTable.jsx`

**Plan vs Actual chart?**

- Components: `src/components/reports/PlanVsActual.jsx`, `CategoryComparison.jsx`
- Queries: [DATA_MODEL.md](./DATA_MODEL.md) → Common Queries

**Recurring transactions?**

- Service: `src/services/recurring.js`
- Schema: [DATA_MODEL.md](./DATA_MODEL.md) → recurring_templates table
- Projection init: `src/App.jsx`

**CSV import?**

- Service: `src/services/import.js`
- Parser: `src/utils/csvParser.js`

**Offline / sync?**

- DB: `src/services/offlineDb.js`
- Sync: `src/services/sync.js`
- Queue: `src/utils/syncQueue.js`
- Status indicator: `src/components/common/SyncStatus.jsx`

**Split expenses / partnerships?**

- Services: `src/services/splitExpenses.js`, `src/services/partnerships.js`
- Page: `src/pages/SplitExpensesPage.jsx`
- Components: `src/components/splits/`
- Setup/schema: [SETUP_GUIDE.md](./SETUP_GUIDE.md) → optional split-expense schema script

**Net worth / accounts?**

- Service: `src/services/accounts.js`
- Schema: [DATA_MODEL.md](./DATA_MODEL.md) → accounts table
- Charts: `src/components/accounts/NetWorthChart.jsx`

**Dark mode?**

- Context: `src/contexts/ThemeContext.jsx`
- Hook: `src/hooks/useTheme.js`
- Patterns: [STYLE_GUIDE.md](./STYLE_GUIDE.md) → Dark Mode section

**Month/year state?**

- Hook: `src/hooks/useMonthYear.js`
- Rules: [STYLE_GUIDE.md](./STYLE_GUIDE.md) → Date Selection pattern

---

## 📊 Documentation Levels

### Level 1: Always Open While Coding

- [DATA_MODEL.md](./DATA_MODEL.md) — "What fields does this table have?"
- [STYLE_GUIDE.md](./STYLE_GUIDE.md) — "What Tailwind classes should I use?"

### Level 2: Reference

- [CONTEXT_GUIDE.md](./CONTEXT_GUIDE.md) — "How do I ask AI for this?"
- [SETUP_GUIDE.md](./SETUP_GUIDE.md) — "How do I configure everything?"

### Level 3: Process

- [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) — "Is this PR safe to merge?"
- [SECURITY.md](./SECURITY.md) — "What are the security invariants?"

---

## 🚀 Common Workflows

### "I want to add a new component"

1. **Model it**: What data does it need? → [DATA_MODEL.md](./DATA_MODEL.md)
2. **Style it**: What patterns apply? → [STYLE_GUIDE.md](./STYLE_GUIDE.md)
3. **Ask AI**: Craft a good prompt → [CONTEXT_GUIDE.md](./CONTEXT_GUIDE.md)
4. **Build it**: Reference existing components in `src/components/`, test locally, commit when working

### "I need to query the database"

1. **Know the schema**: [DATA_MODEL.md](./DATA_MODEL.md)
2. **Test the query**: Write SQL in Supabase SQL Editor first
3. **Convert to JavaScript**: Use Supabase client in `src/services/`
4. **Paginate if needed**: Any `transactions` query must use the 1000-row pagination loop (see DATA_MODEL.md → Design Decision #6)

### "I'm stuck and confused"

1. **What data do I need?** → [DATA_MODEL.md](./DATA_MODEL.md)
2. **How do I ask AI?** → [CONTEXT_GUIDE.md](./CONTEXT_GUIDE.md)
3. **Setup related?** → [SETUP_GUIDE.md](./SETUP_GUIDE.md)

---

## 💡 Pro Tips

- **Supabase 1000-row limit**: Any query on `transactions` must use the pagination loop. See [DATA_MODEL.md](./DATA_MODEL.md) → Design Decisions #6.
- **Month/year state**: Never use `useState` initialized from `getCurrentMonthYear()`. Always use `useMonthYear()`. See [STYLE_GUIDE.md](./STYLE_GUIDE.md) → Date Selection.
- **Dark mode**: Every new component needs `dark:` variants. Use the color mapping table in [STYLE_GUIDE.md](./STYLE_GUIDE.md) → Dark Mode.
- **Transfer categories**: `type = 'transfer'` transactions are excluded from budget totals and analytics. See [DATA_MODEL.md](./DATA_MODEL.md) → Design Decisions #7.
- **Offline mutations**: All write operations should go through `src/services/offlineAware.js`.

**Use keyboard shortcuts to navigate:**

- `Ctrl+F` — Search for table name or feature
- `Ctrl+K` (VS Code) — Go to file quickly

---

## ❓ FAQ

**Q: Where does the full database schema live?**  
A: [DATA_MODEL.md](./DATA_MODEL.md) is the reference. For setup, run `sql_scripts/supabase_schema_create.sql` (core) and optionally `sql_scripts/supabase_split_expenses.sql` for split-expense features.

**Q: How do I avoid AI hallucinations when generating code?**  
A: [CONTEXT_GUIDE.md](./CONTEXT_GUIDE.md)

**Q: How do I set up the project for the first time?**  
A: [SETUP_GUIDE.md](./SETUP_GUIDE.md)

**Q: What Tailwind classes should I use for new components?**  
A: [STYLE_GUIDE.md](./STYLE_GUIDE.md)

**Q: Where are the old phase build guides?**  
A: Archived to `docs/archive/` — QUICK_START.md, PHASE_2.md, PHASE_3.md, ROADMAP.md.

---

## 📞 Need Help?

| Problem            | Solution                                         |
| ------------------ | ------------------------------------------------ |
| Stuck on setup     | [SETUP_GUIDE.md](./SETUP_GUIDE.md)               |
| Need database info | [DATA_MODEL.md](./DATA_MODEL.md)                 |
| AI isn't helping   | [CONTEXT_GUIDE.md](./CONTEXT_GUIDE.md)           |
| Building new UI    | [STYLE_GUIDE.md](./STYLE_GUIDE.md)               |
| Security review    | [SECURITY_CHECKLIST.md](./SECURITY_CHECKLIST.md) |
| Lost in docs       | You're reading this now! 😊                      |

---

**Doc Version**: 2.1  
**Last Updated**: March 18, 2026
