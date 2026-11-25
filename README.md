> [!WARNING]
> This project is still in production and actively evolving. Expect ongoing changes, incomplete areas, and occasional breaking updates.
>
> It was also built heavily with AI assistance as a personal learning tool, with the goal of accelerating exploration and understanding of modern full-stack patterns.

# Budget App

A personal budget tracking app built with React and Vite, backed by a self-hosted PostgreSQL stack. It runs as a web PWA or a Capacitor Android app.

## Features

- Transactions with filtering, per-account tracking, and soft deletes
- Monthly and annual budgets, plan-vs-actual reports, trends, and category drill-down
- Accounts, net worth, cashflow projections, and hypothetical transaction scenarios
- Recurring transactions, grouped schedules, and projected transactions
- Optional amount calculator for transactions, Quick Transactions, recurring entries, and monthly/annual budgets
- Shared expenses, partnerships, and settlements
- CSV import with mapping and duplicate detection; Excel workbook export
- Custom categories with drag-and-drop ordering and reversible archiving
- Offline-first reads and queued writes through Dexie, with last-write-wins sync
- Email/password authentication and per-user Row-Level Security
- Dark/light themes and safe mode for masking financial displays

### Backend

PostgreSQL 16 with RLS, PostgREST, a Fastify auth service, and Nginx, run together with Docker Compose. Nginx serves the app and proxies `/rest/v1` (PostgREST) and `/auth/v1` (auth). See the [setup guide](./docs/SETUP_GUIDE.md) for configuration and upgrades.

## Quick starts

### Development

Use Node.js 22.12+ (the dev container uses Node 22; CI uses Node 24). Start the
self-hosted stack (below) first; Vite proxies its API.

```bash
npm ci
cp .env.example .env   # DEV_API_PROXY_TARGET=http://localhost:8085
npm run dev
```

Open `http://localhost:5173`. For Docker and dev-container details, use the [setup guide](./docs/SETUP_GUIDE.md#vite-development-against-the-self-hosted-stack).

### Self-hosted deployment

```bash
cp .env.selfhost.example .env.selfhost
# Generate and set all required secrets as described in the setup guide.
docker compose --env-file .env.selfhost up -d --pull always
```

The app serves HTTP on port 8085. Use a trusted encrypted network such as Tailscale, or a TLS reverse proxy. The stack pulls matching app/auth/database images; image updates **do not migrate an existing database volume**. See [self-hosted setup](./docs/SETUP_GUIDE.md#self-hosted-local-postgres).

### Android

The native project is already configured. Follow the [Android guide](./docs/android-app.md) for SDK setup, server connection, signing, and release builds. Use `npm run build:android`, not a plain web build.

### Category archiving

Use **Categories → Archive** and **Show archived → Restore**. Historical entries remain intact; new-entry choices exclude archived categories. See [archiving behavior and required database upgrade](./docs/SETUP_GUIDE.md#category-archiving).

### Amount calculator

Type amounts normally, or select the calculator icon beside a supported amount
field. In the annual budget grid, focus a cell to reveal its icon; on mobile,
open the cell editor first. The calculator supports `+`, `-`, `*`, `/`,
parentheses, and decimals using keyboard entry or its keypad. It rounds only the
final result to the nearest cent. **Use amount** fills the field; the form's
normal Save action is still required. Cancel or Escape leaves the field unchanged.
Inline `=...` formulas, percentages, and saved calculation history are not supported.

## Development checks

```bash
npm run lint
node --test scripts/category-archive.test.js scripts/helpers.test.js scripts/calculator.test.js
npm run build
```

Auth and deployment tests require isolated PostgreSQL/Docker resources; see the [validation guide](./docs/SETUP_GUIDE.md#validation).

## Repository map

| Location | Responsibility |
| --- | --- |
| [`src/`](./src/) | React pages/components, query hooks, contexts, backend adapters, offline services, shared helpers |
| [`server/auth/`](./server/auth/) | Self-hosted authentication service and CLI |
| [`sql_scripts/`](./sql_scripts/) | Base schema, incremental migrations, local initialization and RLS checks |
| [`scripts/`](./scripts/) | Regression and deployment smoke tests |
| [`nginx/`](./nginx/) | API proxy, CORS, and security-header templates |
| [`android/`](./android/) | Capacitor native project |
| [`docs/`](./docs/) | Current guides and historical archive |

## Documentation

Start with the [documentation index](./docs/QUICK_REFERENCE.md). The authoritative references are the [data model](./docs/DATA_MODEL.md), [style guide](./docs/STYLE_GUIDE.md), [security model](./docs/SECURITY.md), and [contributor instructions](./.github/AGENTS.md).
