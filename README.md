> [!WARNING]
> This project is still in production and actively evolving. Expect ongoing changes, incomplete areas, and occasional breaking updates.
>
> It was also built heavily with AI assistance as a personal learning tool, with the goal of accelerating exploration and understanding of modern full-stack patterns.

# Budget App

A personal budget tracking app built with React and Vite, with a choice of Supabase or a self-hosted local PostgreSQL backend. Features full offline support, recurring transactions, split expense tracking, CSV import/export, multi-account net worth tracking, and a plan-vs-actual reports page.

## Backend Modes

- **Supabase** — Supabase Auth and PostgreSQL with Row-Level Security (RLS); the default for existing deployments.
- **Self-hosted local** — PostgreSQL 16, PostgREST, and the Fastify auth service, deployed together with Docker Compose. Existing app SQL and RLS policies are reused through a local `auth` compatibility shim.

The selected backend is provided by `BACKEND_MODE` in the runtime `env-config.js` (or `VITE_BACKEND_MODE` during Vite development). Local mode sends data requests to `/rest/v1` and auth requests to `/auth/v1` on the configured server origin.

## Features

- **Transactions** — Full CRUD with filtering, soft deletes, and per-account tracking
- **Budgets** — Monthly budget plans with category allocations and plan-vs-actual comparisons
- **Reports** — Category charts, trend analysis, annual actuals table, category drill-down
- **Accounts** — Checking, savings, credit cards, retirement, brokerage, loans, mortgages; net worth chart
- **Recurring Transactions** — Template-based with grouping (e.g. grouped paycheck splits), auto-projection 30 days out, weekly/biweekly/semi-monthly/monthly/quarterly/yearly schedules
- **Split Expenses** — Partner-style shared expense tracking with paid-by attribution, split methods, and settlement visibility
- **CSV Import** — Column mapping, duplicate detection, account & category assignment, up to 5,000 rows
- **Export** — Excel workbook with transactions, budgets, and accounts sheets
- **Categories** — Custom categories with drag-and-drop sort, type groups (income/needs/wants/savings/transfer)
- **Offline Support** — Full offline-first with Dexie.js (IndexedDB) sync queue and last-write-wins conflict resolution
- **Auth** — Supabase or self-hosted email/password auth, with per-user Row-Level Security on all data
- **Theme** — Persistent dark/light mode; dark is the default

## Tech Stack

| Layer            | Technology                                                        |
| ---------------- | ----------------------------------------------------------------- |
| Frontend    | React 19.2 + Vite 7         |
| Styling     | Tailwind CSS 4.2            |
| Database / API | Supabase PostgreSQL + RLS, or self-hosted PostgreSQL 16 + PostgREST |
| Authentication | Supabase Auth, or Fastify auth service (bcrypt + JWT) |
| Offline DB  | Dexie.js (IndexedDB)        |
| Charts      | Recharts 3.7                |
| Export      | ExcelJS 4.4                 |
| Drag & Drop | dnd-kit                     |
| PWA         | vite-plugin-pwa             |
| Date utils  | date-fns 4.1                |

## Project Structure

```
src/
├── App.jsx               ← App routes, auth guard, recurring + sync init
├── main.jsx              ← React app bootstrap
├── App.css
├── index.css
├── assets/
│   └── react.svg
├── components/
│   ├── accounts/         ← Account CRUD, NetWorthChart, NetWorthSummary
│   ├── budgets/          ← BudgetForm, CategoryList, AnnualBudgetTable, BudgetImportModal
│   ├── reports/          ← CategoryChart, PlanVsActual, Trends, CategoryDrillDown, AnnualActualsTable
│   ├── splits/           ← Shared expense split setup, tracking, and settlement views
│   ├── transactions/     ← Transaction list, form, filters, recurring forms
│   └── common/           ← Modal, TopBar, LoginForm, SignupForm, MonthYearSelector, SyncStatus, ExportData
├── constants/
│   └── pages.jsx         ← Page name registry
├── contexts/             ← MonthYear, SafeMode, Theme providers + memoized values
├── hooks/                ← Month/year, theme, safe mode, session, sync, swipe, threshold, and transaction hooks
├── pages/                ← ReportsPage, TransactionsPage, BudgetPage, SplitExpensesPage, AccountsPage, CategoriesPage, SettingsPage, AuthPage
├── services/
│   ├── backend.js        ← Backend selection and data client
│   ├── auth/             ← Supabase/local auth adapters
│   ├── supabase.js       ← Supabase client init
│   ├── transactions.js   ← CRUD + pagination
│   ├── budgets.js        ← Plans, items, plan-vs-actual
│   ├── accounts.js       ← Account CRUD + balance calc
│   ├── categories.js     ← CRUD + drag-and-drop sort
│   ├── recurring.js      ← Template CRUD + projection engine
│   ├── splitExpenses.js  ← Split expense CRUD + partner balance logic
│   ├── partnerships.js   ← Partner invite/accept/dissolve lifecycle
│   ├── import.js         ← CSV parsing + dedup
│   ├── export.js         ← Excel workbook generation
│   ├── analytics.js      ← Multi-month trend analysis
│   ├── offlineAware.js   ← Offline-first wrappers around core services
│   ├── offlineDb.js      ← Dexie schema + helpers
│   └── sync.js           ← Sync queue + conflict resolution
├── utils/
│   ├── helpers.js        ← Currency/date formatting
│   ├── budgetCalculations.js
│   ├── recurringCalculations.js
│   ├── csvParser.js
│   └── syncQueue.js
```

Additional backend and database setup:

```
server/auth/                   ← Self-hosted Fastify auth service and CLI
sql_scripts/local/             ← Local Postgres compatibility shim and init order
scripts/migrate-from-supabase/ ← Supabase-to-local database migration
nginx/                         ← Local API proxy, CORS and security snippets
```

## Getting Started

### Prerequisites

- Node.js v18+
- Supabase account (free tier works) for the default Supabase mode; Docker Compose for self-hosted mode

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

### Self-hosted Local Postgres (Docker)

```bash
cp .env.selfhost.example .env.selfhost
# Fill in generated POSTGRES_PASSWORD, AUTHENTICATOR_PASSWORD,
# AUTH_ADMIN_PASSWORD and JWT_SECRET values in .env.selfhost.
docker compose -f docker-compose.selfhost.yml --env-file .env.selfhost up -d --pull always
```

The Nginx frontend serves plain HTTP at `http://localhost:8085` by default.
Expose it only over a trusted encrypted network such as Tailscale, or set
`APP_BIND=127.0.0.1` in `.env.selfhost` and put a TLS-terminating reverse proxy
in front of it. Create your first account, then set `ALLOW_SIGNUP=false` in
`.env.selfhost` and recreate the stack. See the
[self-hosted setup guide](./docs/SETUP_GUIDE.md#self-hosted-local-postgres) for
secret generation, backups, upgrades, and migration details. Keep `.env.selfhost`
private and out of version control.

This pulls prebuilt app, auth, and PostgreSQL images; the server needs only the
Compose and environment files, not a repository checkout or SQL bind mounts.
Set `BUDGET_IMAGE_TAG` to pin all three to a matching published release.
For Unraid Compose Manager/Caddy, explicit schema upgrades, and optional local
source builds, see the setup guide linked above. Image updates preserve the
database volume but do not automatically apply schema migrations.

#### Vite development against the self-hosted stack

Start the Compose stack as above, then run Vite in local mode with its same-origin
proxy pointed at the stack's web/nginx service:

```bash
VITE_BACKEND_MODE=local DEV_API_PROXY_TARGET=http://localhost:8085 npm run dev
```

With this setup the browser uses Vite's `/rest/v1` and `/auth/v1` paths, and Vite
proxies them to the stack. Alternatively, `VITE_API_ORIGIN` sets the API server
origin used directly by the client; use it when the server's CORS policy permits
the browser origin. `vite.config.js` enables its proxy only when
`DEV_API_PROXY_TARGET` is set (and uses `VITE_API_ORIGIN` as the proxy target if
both are supplied).

### Android SDK path setup (for release builds)

If Gradle fails with `SDK location not found`, create `android/local.properties` (this file is machine-local and should not be committed):

```properties
sdk.dir=<your-android-sdk-path>
```

Examples:

- macOS:
  ```properties
  sdk.dir=/Users/<your-user>/Library/Android/sdk
  ```
- Linux:
  ```properties
  sdk.dir=/home/<your-user>/Android/Sdk
  ```
- Windows:
  ```properties
  sdk.dir=C:\\Users\\<your-user>\\AppData\\Local\\Android\\Sdk
  ```

Then run:

```bash
cd android
./gradlew bundleRelease
```

For full Android/Capacitor setup and publishing steps, see [android-app.md](./docs/android-app.md).

## Documentation

```
docs/
├── CONTEXT_GUIDE.md        ← How to work with AI effectively on this project
├── DATA_MODEL.md           ← Complete database schema (reference while coding)
├── SECURITY.md             ← Security model and invariants
├── SECURITY_CHECKLIST.md   ← Pre-merge security review checklist
├── SETUP_GUIDE.md          ← Supabase and self-hosted setup walkthrough
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

## Docker Deployment with Supabase (Unraid / Docker)

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
