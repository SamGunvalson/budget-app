# Budget App

A personal budget tracking app built with React and Supabase. Features full offline support, recurring transactions, CSV import/export, multi-account net worth tracking, and a plan-vs-actual reports page.

## Features

- **Transactions** — Full CRUD with filtering, soft deletes, and per-account tracking
- **Budgets** — Monthly budget plans with category allocations and plan-vs-actual comparisons
- **Reports** — Category charts, trend analysis, annual actuals table, category drill-down
- **Accounts** — Checking, savings, credit cards, retirement, brokerage, loans, mortgages; net worth chart
- **Recurring Transactions** — Template-based with grouping (e.g. grouped paycheck splits), auto-projection 30 days out, weekly/biweekly/semi-monthly/monthly/quarterly/yearly schedules
- **CSV Import** — Column mapping, duplicate detection, account & category assignment, up to 5,000 rows
- **Export** — Excel workbook with transactions, budgets, and accounts sheets
- **Categories** — Custom categories with drag-and-drop sort, type groups (income/needs/wants/savings/transfer)
- **Offline Support** — Full offline-first with Dexie.js (IndexedDB) sync queue and last-write-wins conflict resolution
- **Auth** — Supabase email/password auth with per-user Row-Level Security on all data
- **Theme** — Persistent dark/light mode; dark is the default

## Tech Stack

| Layer       | Technology                  |
| ----------- | --------------------------- |
| Frontend    | React 19.2 + Vite 6         |
| Styling     | Tailwind CSS 4.2            |
| Database    | Supabase (PostgreSQL + RLS) |
| Offline DB  | Dexie.js (IndexedDB)        |
| Charts      | Recharts 3.7                |
| Export      | ExcelJS 4.4                 |
| Drag & Drop | dnd-kit                     |
| PWA         | vite-plugin-pwa             |
| Date utils  | date-fns 4.1                |

## Project Structure

```
src/
├── App.jsx               ← Routing, auth guard, recurring init
├── components/
│   ├── accounts/         ← Account CRUD, NetWorthChart, NetWorthSummary
│   ├── budgets/          ← BudgetForm, CategoryList, AnnualBudgetTable, BudgetImportModal
│   ├── reports/          ← CategoryChart, PlanVsActual, Trends, CategoryDrillDown, AnnualActualsTable
│   ├── transactions/     ← Transaction list, form, filters, recurring forms
│   └── common/           ← Modal, TopBar, LoginForm, SignupForm, MonthYearSelector, SyncStatus, ExportData
├── contexts/             ← MonthYear, SafeMode, Theme
├── hooks/                ← useMonthYear, useTheme, useOnlineStatus, useSyncStatus, useTransactionManager, …
├── pages/                ← ReportsPage, TransactionsPage, BudgetPage, AccountsPage, CategoriesPage, SettingsPage, AuthPage
├── services/
│   ├── supabase.js       ← Client init
│   ├── transactions.js   ← CRUD + pagination
│   ├── budgets.js        ← Plans, items, plan-vs-actual
│   ├── accounts.js       ← Account CRUD + balance calc
│   ├── categories.js     ← CRUD + drag-and-drop sort
│   ├── recurring.js      ← Template CRUD + projection engine
│   ├── import.js         ← CSV parsing + dedup
│   ├── export.js         ← Excel workbook generation
│   ├── analytics.js      ← Multi-month trend analysis
│   ├── offlineDb.js      ← Dexie schema + helpers
│   └── sync.js           ← Sync queue + conflict resolution
├── utils/
│   ├── helpers.js        ← Currency/date formatting
│   ├── budgetCalculations.js
│   ├── recurringCalculations.js
│   ├── csvParser.js
│   └── syncQueue.js
└── constants/
    └── pages.jsx         ← Page name registry
```

## Getting Started

### Prerequisites

- Node.js v18+
- Supabase account (free tier works)

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Apply database schema
# Run sql_scripts/supabase_schema_create.sql in the Supabase SQL Editor

# 4. Start the dev server
npm run dev
```

The app will be available at `http://localhost:5173`.

See [docs/SETUP_GUIDE.md](./docs/SETUP_GUIDE.md) for detailed Supabase setup instructions.

## Documentation

```
docs/
├── CONTEXT_GUIDE.md        ← How to work with AI effectively on this project
├── DATA_MODEL.md           ← Complete database schema (reference while coding)
├── SECURITY.md             ← Security model and invariants
├── SECURITY_CHECKLIST.md   ← Pre-merge security review checklist
├── SETUP_GUIDE.md          ← Supabase setup walkthrough
├── STYLE_GUIDE.md          ← Design system, component patterns, dark mode
├── QUICK_REFERENCE.md      ← Navigation index for all docs
└── archive/                ← Completed phase build guides (historical)
```

## Dev Container

This project includes a dev container configuration for a portable, reproducible development environment using **Node 25**.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Getting started

1. Copy `.env.example` to `.env` and fill in your Supabase credentials:
   ```
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```
2. Open the `budget-app/` folder in VS Code.
3. When prompted, click **Reopen in Container** (or run `Dev Containers: Reopen in Container` from the Command Palette).
4. Dependencies install automatically via `npm install`. Once done, start the dev server:
   ```bash
   cd budget-app && npm run dev
   ```
   The app will be available at `http://localhost:5173`.

The container automatically installs ESLint, Prettier, Tailwind CSS IntelliSense, GitLens, and React snippet extensions.

## Self-Hosted Deployment (Unraid / Docker)

The app ships as a lightweight Docker image (~30 MB) — a multi-stage build compiles the React SPA and serves it with Nginx.

### Prerequisites

- Docker (built into Unraid, or Docker Desktop on any machine)
- A [Supabase](https://supabase.com) project with the database schema applied (see `sql_scripts/`)
- Your Supabase **Project URL** and **anon/public key**

### Quick Start (Docker Compose)

```bash
# 1. Clone the repo
git clone https://github.com/SamGunvalson/budget-app.git
cd budget-app

# 2. Create your .env file with Supabase credentials
cp .env.example .env
# Edit .env and fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. Build and start the container
docker compose up -d --build

# 4. Verify it's running
docker ps | grep budget-app
```

The app will be available at **http://\<your-server-ip\>:8085**.

### Accessing via Tailscale

If your Unraid server is on your Tailscale network, access the app from any device at:

```
http://<unraid-tailscale-ip>:8085
```

Tailscale encrypts traffic with WireGuard, so TLS/HTTPS is not required.

### Unraid Docker Template (Manual Setup)

If you prefer the Unraid Docker UI instead of Compose:

1. Build the image on your Unraid server:
   ```bash
   cd /path/to/Thewarguy/budget-app
   docker build \
     --build-arg VITE_SUPABASE_URL=https://your-project.supabase.co \
     --build-arg VITE_SUPABASE_ANON_KEY=your-anon-key \
     -t budget-app .
   ```
2. In the Unraid Docker UI, click **Add Container**:
   - **Repository:** `budget-app` (local image)
   - **Port mapping:** Host `8085` → Container `80`
   - **Restart policy:** Unless stopped
3. Start the container.

### Updating the App

After pulling new code changes:

```bash
cd /path/to/Thewarguy/budget-app
git pull
docker compose up -d --build
```

The old container is automatically replaced.

### Changing the Port

Edit `docker-compose.yml` and change the host port:

```yaml
ports:
  - "8085:80" # change 8085 to any free port
```

Then rebuild: `docker compose up -d --build`
