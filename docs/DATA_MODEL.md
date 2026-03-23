# Budget App Data Model

## Overview

This document defines the complete data schema for the budget app. **Reference this document when working with AI to avoid hallucinations and ensure consistency.**

## Core Principles

- All monetary values stored as integers (cents) to avoid floating-point issues
- All timestamps use UTC
- Soft deletes where applicable (deleted_at column)
- Row-level security (RLS) enforced at database level

---

## Database Schema (Supabase/PostgreSQL)

### Table: `users`

**Purpose**: Store user accounts (handled by Supabase Auth, extended here for preferences)

| Column       | Type        | Constraints      | Description                |
| ------------ | ----------- | ---------------- | -------------------------- |
| `id`         | UUID        | PRIMARY KEY      | Supabase auth user ID      |
| `email`      | TEXT        | UNIQUE, NOT NULL | User email                 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW()    | Account creation timestamp |
| `currency`   | VARCHAR(3)  | DEFAULT 'USD'    | ISO currency code          |
| `timezone`   | TEXT        | DEFAULT 'UTC'    | User timezone              |

**Indexes**:

- Primary key on `id`
- Unique index on `email`

**RLS**: Users can only access their own records

---

### Table: `categories`

**Purpose**: Budget categories (e.g., Groceries, Rent, Entertainment)

| Column       | Type        | Constraints             | Description                                          |
| ------------ | ----------- | ----------------------- | ---------------------------------------------------- |
| `id`         | UUID        | PRIMARY KEY             | Category ID                                          |
| `user_id`    | UUID        | FOREIGN KEY → users(id) | Owner of category                                    |
| `name`       | TEXT        | NOT NULL                | Category name (e.g., "Groceries")                    |
| `type`       | TEXT        | NOT NULL                | 'income', 'needs', 'wants', 'savings', or 'transfer' |
| `color`      | VARCHAR(7)  | DEFAULT '#3B82F6'       | Hex color for UI                                     |
| `icon`       | TEXT        | NULL                    | Icon identifier (optional)                           |
| `is_active`  | BOOLEAN     | DEFAULT TRUE            | Soft delete flag                                     |
| `sort_order` | INTEGER     | DEFAULT 0               | Manual sort position within type group               |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW()           | Creation timestamp                                   |

**Constraints**:

- `type` CHECK: Must be one of ('income', 'needs', 'wants', 'savings', 'transfer')
- Unique: `(user_id, name)` where `is_active = true`

**Indexes**:

- `idx_categories_sort` on `(user_id, type, sort_order)` where `is_active = true`

**Default Categories** (created on user signup):

```javascript
const defaultCategories = [
  { name: "Groceries", type: "needs", color: "#10B981" },
  { name: "Rent/Mortgage", type: "needs", color: "#EF4444" },
  { name: "Utilities", type: "needs", color: "#F59E0B" },
  { name: "Transportation", type: "needs", color: "#8B5CF6" },
  { name: "Entertainment", type: "wants", color: "#EC4899" },
  { name: "Dining Out", type: "wants", color: "#06B6D4" },
  { name: "Emergency Fund", type: "savings", color: "#14B8A6" },
  { name: "Investments", type: "savings", color: "#6366F1" },
  { name: "Account Transfer", type: "transfer", color: "#64748B" },
  { name: "Credit Card Payment", type: "transfer", color: "#64748B" },
  { name: "Investment Contribution", type: "transfer", color: "#64748B" },
  { name: "Reimbursement / Refund", type: "transfer", color: "#64748B" },
];
```

**RLS**: Users can only access their own categories

---

### Table: `user_preferences`

**Purpose**: Store per-user UI preferences (e.g., category type group display order)

| Column             | Type        | Constraints             | Description                               |
| ------------------ | ----------- | ----------------------- | ----------------------------------------- |
| `id`               | UUID        | PRIMARY KEY             | Preference row ID                         |
| `user_id`          | UUID        | FOREIGN KEY → users(id) | Preference owner                          |
| `preference_key`   | TEXT        | NOT NULL                | Key identifier (e.g., 'type_group_order') |
| `preference_value` | JSONB       | NOT NULL, DEFAULT '{}'  | JSON value for the preference             |
| `created_at`       | TIMESTAMPTZ | DEFAULT NOW()           | Creation timestamp                        |
| `updated_at`       | TIMESTAMPTZ | DEFAULT NOW()           | Last update timestamp                     |

**Constraints**:

- Unique: `(user_id, preference_key)`

**Known preference keys**:

- `type_group_order`: Array of type strings defining display order, e.g. `["income", "needs", "wants", "savings"]`

**RLS**: Users can only access their own preferences

---

### Table: `budget_plans`

**Purpose**: Monthly budget plans (what user intends to spend)

| Column         | Type        | Constraints             | Description                     |
| -------------- | ----------- | ----------------------- | ------------------------------- |
| `id`           | UUID        | PRIMARY KEY             | Budget plan ID                  |
| `user_id`      | UUID        | FOREIGN KEY → users(id) | Budget owner                    |
| `month`        | INT         | NOT NULL                | Month (1-12)                    |
| `year`         | INT         | NOT NULL                | Year (e.g., 2026)               |
| `name`         | TEXT        | NULL                    | Optional plan name              |
| `total_income` | BIGINT      | DEFAULT 0               | Expected monthly income (cents) |
| `created_at`   | TIMESTAMPTZ | DEFAULT NOW()           | Creation timestamp              |
| `updated_at`   | TIMESTAMPTZ | DEFAULT NOW()           | Last update timestamp           |

**Constraints**:

- Unique: `(user_id, month, year)`
- CHECK: `month BETWEEN 1 AND 12`
- CHECK: `year >= 2020 AND year <= 2100`

**RLS**: Users can only access their own budget plans

---

### Table: `budget_items`

**Purpose**: Per-category budget allocations within a plan

| Column           | Type   | Constraints                    | Description              |
| ---------------- | ------ | ------------------------------ | ------------------------ |
| `id`             | UUID   | PRIMARY KEY                    | Budget item ID           |
| `budget_plan_id` | UUID   | FOREIGN KEY → budget_plans(id) | Parent budget plan       |
| `category_id`    | UUID   | FOREIGN KEY → categories(id)   | Category being budgeted  |
| `planned_amount` | BIGINT | NOT NULL                       | Planned spending (cents) |
| `notes`          | TEXT   | NULL                           | Optional notes           |

**Constraints**:

- Unique: `(budget_plan_id, category_id)`
- CHECK: `planned_amount >= 0`

**RLS**: Users can only access budget items for their own plans

---

### Table: `accounts`

**Purpose**: Financial accounts for net worth tracking (checking, savings, credit cards, retirement, etc.)

| Column             | Type        | Constraints             | Description                           |
| ------------------ | ----------- | ----------------------- | ------------------------------------- |
| `id`               | UUID        | PRIMARY KEY             | Account ID                            |
| `user_id`          | UUID        | FOREIGN KEY → users(id) | Account owner                         |
| `name`             | TEXT        | NOT NULL                | Account name (e.g., "Chase Checking") |
| `type`             | TEXT        | NOT NULL                | Account type (see CHECK below)        |
| `starting_balance` | BIGINT      | DEFAULT 0               | Opening balance in cents              |
| `is_active`        | BOOLEAN     | DEFAULT TRUE            | Soft delete flag                      |
| `closed_at`        | DATE        | DEFAULT NULL            | Closure date (NULL = open)            |
| `created_at`       | TIMESTAMPTZ | DEFAULT NOW()           | Creation timestamp                    |
| `updated_at`       | TIMESTAMPTZ | DEFAULT NOW()           | Last update timestamp                 |

**Constraints**:

- `type` CHECK: Must be one of (`'checking'`, `'savings'`, `'credit_card'`, `'retirement'`, `'brokerage'`, `'loan'`, `'mortgage'`)
- Unique: `(user_id, name)` where `is_active = true`

**Account type groups**:

- **Asset accounts** (balance increases with income): `checking`, `savings`, `retirement`, `brokerage`
- **Liability accounts** (balance increases with charges): `credit_card`, `loan`, `mortgage`

**Balance calculation**: `starting_balance + SUM(transactions)` — for asset accounts, income adds and expenses subtract; for liability accounts, expenses add (charges) and income subtracts (payments).

**RLS**: Users can only access their own accounts

---

### Table: `transactions`

**Purpose**: Actual income/expense transactions

| Column                  | Type        | Constraints                                 | Description                                                                                                                                           |
| ----------------------- | ----------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                    | UUID        | PRIMARY KEY                                 | Transaction ID                                                                                                                                        |
| `user_id`               | UUID        | FOREIGN KEY → users(id)                     | Transaction owner                                                                                                                                     |
| `account_id`            | UUID        | FOREIGN KEY → accounts(id), NOT NULL        | Account this transaction belongs to                                                                                                                   |
| `category_id`           | UUID        | FOREIGN KEY → categories(id)                | Transaction category                                                                                                                                  |
| `amount`                | BIGINT      | NOT NULL                                    | Amount in cents — always a positive absolute value; `is_income` determines direction (income adds, expense subtracts)                                 |
| `description`           | TEXT        | NOT NULL                                    | Transaction description                                                                                                                               |
| `payee`                 | TEXT        | NULL                                        | Who the money is going to or coming from                                                                                                              |
| `transaction_date`      | DATE        | NOT NULL                                    | Date of transaction                                                                                                                                   |
| `is_income`             | BOOLEAN     | DEFAULT FALSE                               | True if income, false if expense                                                                                                                      |
| `transfer_group_id`     | UUID        | NULL                                        | Shared UUID linking both sides of a transfer. `NULL` on a transfer-type transaction indicates a single-account balance adjustment (no companion leg). |
| `status`                | TEXT        | NOT NULL, DEFAULT 'posted'                  | Transaction lifecycle: 'projected', 'pending', 'posted'                                                                                               |
| `recurring_template_id` | UUID        | FOREIGN KEY → recurring_templates(id), NULL | Back-link to the recurring template that generated this transaction                                                                                   |
| `created_at`            | TIMESTAMPTZ | DEFAULT NOW()                               | Record creation timestamp                                                                                                                             |
| `updated_at`            | TIMESTAMPTZ | DEFAULT NOW()                               | Last update timestamp                                                                                                                                 |
| `deleted_at`            | TIMESTAMPTZ | NULL                                        | Soft delete timestamp                                                                                                                                 |

**Constraints**:

- CHECK: `amount != 0` (no zero-amount transactions)
- CHECK: `status IN ('projected', 'pending', 'posted')`
- UNIQUE partial: `(recurring_template_id, transaction_date, account_id) WHERE recurring_template_id IS NOT NULL AND deleted_at IS NULL` — at most one active transaction per recurring template per date per account (allows dual-leg entries for transfers)

**Indexes**:

- Index on `(user_id, transaction_date DESC)` for fast queries
- Index on `(user_id, category_id)` for aggregations
- Index on `(account_id)` for account balance queries
- Index on `deleted_at IS NULL` for active transactions
- Index on `(user_id, status, transaction_date)` for status-based queries
- Index on `(recurring_template_id, transaction_date)` where `recurring_template_id IS NOT NULL`
- **Unique** index on `(recurring_template_id, transaction_date, account_id)` where `recurring_template_id IS NOT NULL AND deleted_at IS NULL` — prevents duplicate projected/pending/posted transactions for the same template+date+account while allowing transfer dual-leg entries

**RLS**: Users can only access their own transactions

---

### Table: `recurring_templates`

**Purpose**: Templates for recurring transactions (subscriptions, rent, transfers, grouped paycheck/mortgage breakdowns, etc.)

**Group Model**: A group parent row stores administrative defaults (name, payee, account, schedule) that are inherited by child line items. When applied, only child line items generate actual transactions — no auto net deposit is created. The parent's `amount` stores the calculated net (sum of signed child amounts) for display/sorting purposes.

| Column              | Type        | Constraints                                 | Description                                                                                                                                                |
| ------------------- | ----------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | UUID        | PRIMARY KEY                                 | Template ID                                                                                                                                                |
| `user_id`           | UUID        | FOREIGN KEY → users(id)                     | Template owner                                                                                                                                             |
| `account_id`        | UUID        | FOREIGN KEY → accounts(id), NOT NULL        | Source account (group parent: default for new line items)                                                                                                  |
| `category_id`       | UUID        | FOREIGN KEY → categories(id)                | Category (group parent: optional reference; children: required)                                                                                            |
| `description`       | TEXT        | NOT NULL                                    | Transaction description (group parent: group name; children: optional label)                                                                               |
| `payee`             | TEXT        | NULL                                        | Payee (group parent: required default; children: optional override, inherits from parent at apply-time)                                                    |
| `amount`            | BIGINT      | NOT NULL                                    | Amount in cents — always a positive absolute value (group parent: absolute net from children; children: absolute amount; `is_income` determines direction) |
| `is_income`         | BOOLEAN     | DEFAULT FALSE                               | True if income (group parent: true if net >= 0)                                                                                                            |
| `is_transfer`       | BOOLEAN     | DEFAULT FALSE                               | True if this is a transfer template                                                                                                                        |
| `to_account_id`     | UUID        | FOREIGN KEY → accounts(id), NULL            | Destination account (transfers only)                                                                                                                       |
| `frequency`         | TEXT        | NOT NULL                                    | 'weekly', 'biweekly', 'semi_monthly', 'monthly', 'quarterly', 'yearly'                                                                                     |
| `day_of_month`      | INT         | NULL                                        | Day of month (1-31) for monthly/semi-monthly                                                                                                               |
| `day_of_month_2`    | INT         | NULL                                        | Second day (1-31) for semi-monthly                                                                                                                         |
| `day_of_week`       | INT         | NULL                                        | Day of week (0-6) for weekly                                                                                                                               |
| `start_date`        | DATE        | NOT NULL                                    | First occurrence date                                                                                                                                      |
| `end_date`          | DATE        | NULL                                        | Optional end date                                                                                                                                          |
| `last_applied`      | DATE        | NULL                                        | Last date template was applied                                                                                                                             |
| `group_id`          | UUID        | FOREIGN KEY → recurring_templates(id), NULL | Parent group ID (children only)                                                                                                                            |
| `is_group_parent`   | BOOLEAN     | DEFAULT FALSE                               | True if this is a group parent                                                                                                                             |
| `group_order`       | INT         | DEFAULT 0                                   | Sort order within group (children)                                                                                                                         |
| `auto_confirm`      | BOOLEAN     | NOT NULL, DEFAULT TRUE                      | If true, applied transactions start as 'posted'; if false, start as 'pending'                                                                              |
| `projected_through` | DATE        | NULL                                        | Last date through which projected transactions have been generated                                                                                         |
| `is_paused`         | BOOLEAN     | DEFAULT FALSE                               | If true, template is paused and skipped during projection (auto-set when account is closed)                                                                |
| `is_active`         | BOOLEAN     | DEFAULT TRUE                                | Active status                                                                                                                                              |
| `created_at`        | TIMESTAMPTZ | DEFAULT NOW()                               | Creation timestamp                                                                                                                                         |

**Constraints**:

- CHECK: `frequency IN ('weekly', 'biweekly', 'semi_monthly', 'monthly', 'quarterly', 'yearly')`
- CHECK: `day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 31)`
- CHECK: `day_of_month_2 IS NULL OR (day_of_month_2 BETWEEN 1 AND 31)`
- CHECK: `day_of_week IS NULL OR (day_of_week BETWEEN 0 AND 6)`
- CHECK: `is_transfer = FALSE OR to_account_id IS NOT NULL`

**RLS**: Users can only access their own templates

**TypeScript Interface**:

```typescript
interface RecurringTemplate {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string;
  description: string;
  payee?: string;
  amount: number;
  is_income: boolean;
  is_transfer: boolean;
  to_account_id?: string;
  frequency:
    | "weekly"
    | "biweekly"
    | "semi_monthly"
    | "monthly"
    | "quarterly"
    | "yearly";
  day_of_month?: number;
  day_of_month_2?: number;
  day_of_week?: number;
  start_date: string;
  end_date?: string;
  last_applied?: string;
  group_id?: string;
  is_group_parent: boolean;
  group_order: number;
  auto_confirm: boolean;
  projected_through?: string;
  is_paused: boolean;
  is_active: boolean;
  created_at: string;
  // Joined relations
  children?: RecurringTemplate[];
  categories?: { id: string; name: string; color: string; type: string };
  accounts?: { id: string; name: string; type: string };
  to_account?: { id: string; name: string; type: string };
}
```

---

### Table: `partnerships`

**Purpose**: Link two users for shared expense splitting (2-person partnerships)

| Column          | Type        | Constraints                 | Description                      |
| --------------- | ----------- | --------------------------- | -------------------------------- |
| `id`            | UUID        | PRIMARY KEY                 | Partnership ID                   |
| `user_a_id`     | UUID        | FOREIGN KEY → users(id)     | Inviter                          |
| `user_b_id`     | UUID        | FOREIGN KEY → users(id)     | Invitee (NULL until accepted)    |
| `invited_email` | TEXT        | NOT NULL                    | Email of invited partner         |
| `status`        | TEXT        | NOT NULL, DEFAULT 'pending' | 'pending', 'active', 'dissolved' |
| `created_at`    | TIMESTAMPTZ | DEFAULT NOW()               | Creation timestamp               |
| `updated_at`    | TIMESTAMPTZ | DEFAULT NOW()               | Last update timestamp            |

**Constraints**:

- CHECK: `status IN ('pending', 'active', 'dissolved')`
- Unique partial: `(LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id)) WHERE status = 'active'` — at most one active partnership between any two users
- Unique partial: `(user_a_id, invited_email) WHERE status = 'pending'` — no duplicate pending invites

**RLS**: INSERT allowed only for the inviter (`user_a_id`). SELECT, UPDATE, and DELETE are allowed for either member once the invite is accepted (`user_a_id` or `user_b_id`). While the invite is still pending (`user_b_id` is `NULL`), the invitee is matched on `invited_email` via JWT claims (`current_setting('request.jwt.claims')::jsonb ->> 'email'`) — a direct `auth.users` query cannot be used here because the `authenticated` role does not have `SELECT` on that table.

---

### Table: `split_expenses`

**Purpose**: Shared expense ledger entries within a partnership (Splitwise-style)

| Column            | Type        | Constraints                          | Description                               |
| ----------------- | ----------- | ------------------------------------ | ----------------------------------------- |
| `id`              | UUID        | PRIMARY KEY                          | Split expense ID                          |
| `partnership_id`  | UUID        | FOREIGN KEY → partnerships(id)       | Parent partnership                        |
| `paid_by_user_id` | UUID        | FOREIGN KEY → users(id)              | Who fronted the money                     |
| `transaction_id`  | UUID        | FOREIGN KEY → transactions(id), NULL | Optional link to payer's real transaction |
| `description`     | TEXT        | NOT NULL                             | Expense description                       |
| `total_amount`    | BIGINT      | NOT NULL, CHECK > 0                  | Total amount in cents                     |
| `payer_share`     | BIGINT      | NOT NULL, CHECK >= 0                 | Payer's portion in cents                  |
| `partner_share`   | BIGINT      | NOT NULL, CHECK >= 0                 | Non-payer's portion in cents              |
| `is_settlement`   | BOOLEAN     | DEFAULT FALSE                        | True if this is a settle-up payment       |
| `expense_date`    | DATE        | NOT NULL, DEFAULT CURRENT_DATE       | Date of expense                           |
| `created_at`      | TIMESTAMPTZ | DEFAULT NOW()                        | Record creation timestamp                 |
| `deleted_at`      | TIMESTAMPTZ | NULL                                 | Soft delete timestamp                     |

**Constraints**:

- CHECK: `total_amount > 0`
- CHECK: `payer_share + partner_share = total_amount`

**Balance formula** (from current user's perspective, positive = partner owes you):

- Non-settlements: `+partner_share` when I paid, `-partner_share` when partner paid
- Settlements: `-total_amount` when I paid partner, `+total_amount` when partner paid me

**RLS**: All operations scoped via active partnership membership

---

### Function: `get_partner_email(p_partnership_id UUID)`

**Purpose**: Allows the invitee (user_b) to look up the inviter's (user_a) email, which is not stored on the `partnerships` row and is not accessible via the normal Supabase client API.

| Attribute   | Value                                                                                   |
| ----------- | --------------------------------------------------------------------------------------- |
| Returns     | `TEXT` — the inviter's email, or `NULL` if the caller is not user_b of that partnership |
| Security    | `SECURITY DEFINER` — runs as the DB owner to access `auth.users`                        |
| Access      | `authenticated` role only; `PUBLIC` execute revoked                                     |
| Scope guard | `AND p.user_b_id = auth.uid()` — cannot be used to look up arbitrary users' emails      |

**Called from**: `src/services/partnerships.js` → `getPartnerEmail()` (invitee branch only)

---

## Relationships

```
users (1) ──→ (N) categories
users (1) ──→ (N) accounts
users (1) ──→ (N) budget_plans
users (1) ──→ (N) transactions
users (1) ──→ (N) recurring_templates
users (1) ──→ (N) partnerships (user_a_id — inviter)
users (1) ──→ (N) partnerships (user_b_id — invitee)

accounts (1) ──→ (N) transactions
accounts (1) ──→ (N) recurring_templates (account_id)
accounts (1) ──→ (N) recurring_templates (to_account_id, transfers)
budget_plans (1) ──→ (N) budget_items
categories (1) ──→ (N) budget_items
categories (1) ──→ (N) transactions
categories (1) ──→ (N) recurring_templates
recurring_templates (1) ──→ (N) recurring_templates (group parent → children via group_id)
partnerships (1) ──→ (N) split_expenses
transactions (1) ──→ (0..1) split_expenses (optional link via transaction_id)
```

---

## SQL Migration Scripts

### Step 1: Enable UUID extension

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Step 2: Create categories table

```sql
CREATE TABLE categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'needs', 'wants', 'savings', 'transfer')),
  color VARCHAR(7) DEFAULT '#3B82F6',
  icon TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name, is_active)
);

-- Enable RLS
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own categories
CREATE POLICY "Users can manage their own categories"
  ON categories
  FOR ALL
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_categories_user ON categories(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_categories_sort ON categories(user_id, type, sort_order) WHERE is_active = TRUE;
```

### Step 3: Create user_preferences table

```sql
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key TEXT NOT NULL,
  preference_value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, preference_key)
);

-- Enable RLS
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "Users can manage their own preferences"
  ON user_preferences
  FOR ALL
  USING (auth.uid() = user_id);

-- Index
CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);
```

### Step 4: Create budget_plans table

```sql
CREATE TABLE budget_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INT NOT NULL CHECK (year >= 2020 AND year <= 2100),
  name TEXT,
  total_income BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month, year)
);

-- Enable RLS
ALTER TABLE budget_plans ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "Users can manage their own budget plans"
  ON budget_plans
  FOR ALL
  USING (auth.uid() = user_id);

-- Index
CREATE INDEX idx_budget_plans_user_date ON budget_plans(user_id, year DESC, month DESC);
```

### Step 5: Create budget_items table

```sql
CREATE TABLE budget_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  budget_plan_id UUID NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  planned_amount BIGINT NOT NULL CHECK (planned_amount >= 0),
  notes TEXT,
  UNIQUE(budget_plan_id, category_id)
);

-- Enable RLS
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;

-- RLS Policy (via budget_plan ownership)
CREATE POLICY "Users can manage budget items for their plans"
  ON budget_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM budget_plans bp
      WHERE bp.id = budget_items.budget_plan_id
      AND bp.user_id = auth.uid()
    )
  );

-- Index
CREATE INDEX idx_budget_items_plan ON budget_items(budget_plan_id);
CREATE INDEX idx_budget_items_category ON budget_items(category_id);
```

### Step 6: Create accounts table

```sql
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'retirement', 'brokerage', 'loan', 'mortgage')),
  starting_balance BIGINT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  closed_at DATE DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "Users can manage their own accounts"
  ON accounts
  FOR ALL
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_accounts_user ON accounts(user_id) WHERE is_active = TRUE;
CREATE UNIQUE INDEX idx_accounts_user_name ON accounts(user_id, name) WHERE is_active = TRUE;
```

### Step 7: Create transactions table

```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount BIGINT NOT NULL CHECK (amount != 0),
  description TEXT NOT NULL,
  payee TEXT NULL,
  transaction_date DATE NOT NULL,
  is_income BOOLEAN DEFAULT FALSE,
  transfer_group_id UUID NULL,
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('projected', 'pending', 'posted')),
  recurring_template_id UUID,  -- FK added after recurring_templates table exists
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Enable RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies (split so soft-delete UPDATE can set deleted_at)
CREATE POLICY "Users can view their own active transactions"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can insert their own transactions"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
  ON transactions FOR UPDATE
  USING (auth.uid() = user_id AND deleted_at IS NULL)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions"
  ON transactions FOR DELETE
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_transactions_user_date ON transactions(user_id, transaction_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_category ON transactions(category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_account ON transactions(account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_transfer_group ON transactions(transfer_group_id) WHERE transfer_group_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_transactions_user_month ON transactions(user_id, EXTRACT(YEAR FROM transaction_date), EXTRACT(MONTH FROM transaction_date)) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_status ON transactions(user_id, status, transaction_date);

-- Unique partial index: prevent duplicate recurring transactions per template per date per account.
-- account_id is included because transfers/linked-transfers create two legs (source + destination)
-- that share the same recurring_template_id and transaction_date but use different accounts.
CREATE UNIQUE INDEX idx_transactions_no_dup_recurring
  ON transactions(recurring_template_id, transaction_date, account_id)
  WHERE recurring_template_id IS NOT NULL AND deleted_at IS NULL;
```

### Step 8: Create recurring_templates table

```sql
CREATE TABLE recurring_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  description TEXT NOT NULL,
  payee TEXT,
  amount BIGINT NOT NULL,
  is_income BOOLEAN DEFAULT FALSE,
  is_transfer BOOLEAN DEFAULT FALSE,
  to_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'semi_monthly', 'monthly', 'quarterly', 'yearly')),
  day_of_month INT CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 31)),
  day_of_month_2 INT CHECK (day_of_month_2 IS NULL OR (day_of_month_2 BETWEEN 1 AND 31)),
  day_of_week INT CHECK (day_of_week IS NULL OR (day_of_week BETWEEN 0 AND 6)),
  start_date DATE NOT NULL,
  end_date DATE,
  last_applied DATE,
  group_id UUID REFERENCES recurring_templates(id) ON DELETE CASCADE,
  is_group_parent BOOLEAN DEFAULT FALSE,
  group_order INT DEFAULT 0,
  auto_confirm BOOLEAN NOT NULL DEFAULT TRUE,
  projected_through DATE,
  is_paused BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT transfer_needs_to_account CHECK (is_transfer = FALSE OR to_account_id IS NOT NULL)
);

-- Enable RLS
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policy
CREATE POLICY "Users can manage their own recurring templates"
  ON recurring_templates
  FOR ALL
  USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_recurring_templates_user ON recurring_templates(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_recurring_templates_group ON recurring_templates(group_id) WHERE group_id IS NOT NULL AND is_active = TRUE;
CREATE INDEX idx_recurring_templates_to_account ON recurring_templates(to_account_id) WHERE to_account_id IS NOT NULL;

-- Step 9: Add FK from transactions to recurring_templates (now that table exists)
ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_recurring_template
  FOREIGN KEY (recurring_template_id) REFERENCES recurring_templates(id) ON DELETE SET NULL;

CREATE INDEX idx_transactions_recurring_template ON transactions(recurring_template_id, transaction_date) WHERE recurring_template_id IS NOT NULL;
```

---

## TypeScript Types (for Frontend)

```typescript
export interface User {
  id: string;
  email: string;
  created_at: string;
  currency: string;
  timezone: string;
}

export interface Category {
  id: string;
  user_id: string;
  name: string;
  type: "income" | "needs" | "wants" | "savings" | "transfer";
  color: string;
  icon?: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface BudgetPlan {
  id: string;
  user_id: string;
  month: number;
  year: number;
  name?: string;
  total_income: number; // in cents
  created_at: string;
  updated_at: string;
}

export interface BudgetItem {
  id: string;
  budget_plan_id: string;
  category_id: string;
  planned_amount: number; // in cents
  notes?: string;
}

export interface Account {
  id: string;
  user_id: string;
  name: string;
  type:
    | "checking"
    | "savings"
    | "credit_card"
    | "retirement"
    | "brokerage"
    | "loan"
    | "mortgage";
  starting_balance: number; // in cents
  is_active: boolean;
  closed_at?: string; // ISO date string, NULL = open
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string;
  amount: number; // in cents
  description: string;
  payee?: string;
  transaction_date: string; // ISO date string
  is_income: boolean;
  transfer_group_id?: string;
  status: "projected" | "pending" | "posted";
  recurring_template_id?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string;
}

export interface RecurringTemplate {
  id: string;
  user_id: string;
  account_id: string;
  category_id: string;
  description: string;
  payee?: string;
  amount: number; // in cents
  is_income: boolean;
  is_transfer: boolean;
  to_account_id?: string;
  frequency:
    | "weekly"
    | "biweekly"
    | "semi_monthly"
    | "monthly"
    | "quarterly"
    | "yearly";
  day_of_month?: number;
  day_of_month_2?: number;
  day_of_week?: number;
  start_date: string;
  end_date?: string;
  last_applied?: string;
  group_id?: string;
  is_group_parent: boolean;
  auto_confirm: boolean;
  projected_through?: string;
  group_order: number;
  is_paused: boolean;
  is_active: boolean;
  created_at: string;
  // Joined relations (when fetched with select)
  children?: RecurringTemplate[];
  categories?: { id: string; name: string; color: string; type: string };
  accounts?: { id: string; name: string; type: string };
  to_accounts?: { id: string; name: string; type: string };
}
```

---

## Key Design Decisions

### 1. **Cents-based storage**

All monetary values stored as integers (cents) to avoid floating-point rounding errors.

**Example**: $123.45 → stored as `12345`

**Conversion functions**:

```javascript
const toCents = (dollars) => Math.round(dollars * 100);
const toDollars = (cents) => cents / 100;
```

### 2. **Soft deletes for transactions**

Transactions use `deleted_at` instead of hard deletes to maintain audit trail.

### 3. **Row-level security (RLS)**

All tables enforce RLS at the database level—no data leaks between users.

### 4. **Unique constraints**

- Categories: One active category per user with same name
- Budget plans: One plan per user per month/year
- Budget items: One budget item per plan per category

### 5. **Monthly budget scoping**

Budget plans are monthly—keeps UI simple and matches most budgeting workflows.

### 6. **Supabase pagination (1000-row limit)**

Supabase returns a maximum of 1000 rows per query by default. Any query on the `transactions` table that could return more than 1000 rows **must** use pagination via `.range(from, to)` in a loop.

**Standard pagination pattern used across the codebase:**

```javascript
const PAGE_SIZE = 1000;
let allData = [];
let from = 0;
let hasMore = true;

while (hasMore) {
  const { data, error } = await supabase
    .from("transactions")
    .select("...")
    // ...filters...
    .order("transaction_date", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (error) throw error;
  allData = allData.concat(data);
  if (data.length < PAGE_SIZE) {
    hasMore = false;
  } else {
    from += PAGE_SIZE;
  }
}
```

**Paginated functions** (all in `src/services/`):

- `transactions.js` → `getTransactions`, `getTransactionsYTD`, `getTransactionsForYear`
- `analytics.js` → `getTrendTransactions`, `getYearlyTrendTransactions`
- `budgets.js` → `getPlanVsActual` (txn sub-query), `getPlanVsActualYTD` (txn sub-query)
- `import.js` → `checkDuplicates`

**When adding new queries:** If fetching from `transactions` (or any table that may exceed 1000 rows), always use the pagination loop above. Queries scoped to small result sets (e.g., `categories`, `budget_plans` with max 12 rows/year) do not need pagination.

### 7. **Non-budgeting transfer categories**

Categories with `type = 'transfer'` represent money moving between accounts (e.g., account transfers, credit card payments, investment contributions, reimbursements) or single-account balance adjustments (e.g., market gain/loss). All transfer-type transactions:

- **Are excluded** from income/expense totals, budget plan-vs-actual, and analytics aggregation
- **Are visible** in the transaction list with a neutral "Transfer" badge
- **Cannot be assigned** a planned budget amount (filtered out of budget item inputs)
- **Transfer nature is determined by `category.type`**, not the `is_income` flag

There are three sub-types, distinguished by `transfer_group_id` and `is_income`:

| Sub-type                                | `transfer_group_id`      | Legs | `is_income`                                   |
| --------------------------------------- | ------------------------ | ---- | --------------------------------------------- |
| **Standard transfer** (from→to)         | Shared UUID on both rows | 2    | `false` on source, `true` on destination      |
| **Linked transfer** (budget-impacting)  | Shared UUID on both rows | 2    | User-chosen on main leg; flipped on companion |
| **Balance adjustment** (single-account) | `NULL`                   | 1    | `true` = gain, `false` = loss                 |

Balance adjustments are used for events like market gains/losses on investment accounts where no money moves between accounts — only the account's balance changes.

### 8. **Recurring transaction deduplication**

Duplicate projected/pending transactions for the same recurring template + date are prevented by a three-layer strategy:

1. **Application-level concurrency lock** (`recurring.js`): A module-scoped promise (`_generatingPromise`) ensures that concurrent calls to `generateProjectedTransactions()` — caused by React StrictMode double-firing `useEffect`, or multiple browser tabs — coalesce into a single database pass.
2. **Pre-insert dedup query** (`applyTemplateWithStatus()`): Before each insert, queries the DB for an existing active transaction with the same `(recurring_template_id, transaction_date)`. Skips the insert if found.
3. **Database-level unique partial index**: `idx_transactions_no_dup_recurring` on `(recurring_template_id, transaction_date, account_id) WHERE recurring_template_id IS NOT NULL AND deleted_at IS NULL`. This is the hard guarantee — if both application guards fail due to a timing race, the DB rejects the duplicate and the app catches error code `23505` gracefully. The index includes `account_id` because transfer and linked-transfer templates (e.g., 401k contributions) legitimately create two transactions per occurrence date — one on the source account and one on the destination — both sharing the same `recurring_template_id` and `transaction_date`.

The partial filter preserves soft-delete semantics: once a duplicate is soft-deleted (`deleted_at` set), a new transaction can be generated for the same template + date + account.

The dedup check in `generateProjectedTransactions()` also includes `posted` status (not just `projected`/`pending`) so that auto-confirmed transactions from earlier runs are not regenerated.

---

## Common Queries (for AI Reference)

### Get all transactions for a given month

```sql
SELECT t.*, c.name as category_name, c.color as category_color
FROM transactions t
JOIN categories c ON t.category_id = c.id
WHERE t.user_id = $1
  AND EXTRACT(YEAR FROM t.transaction_date) = $2
  AND EXTRACT(MONTH FROM t.transaction_date) = $3
  AND t.deleted_at IS NULL
ORDER BY t.transaction_date DESC;
```

### Get Plan vs Actual for a month

```sql
SELECT
  c.id as category_id,
  c.name as category_name,
  c.color,
  COALESCE(bi.planned_amount, 0) as planned,
  COALESCE(SUM(CASE WHEN t.is_income = false THEN ABS(t.amount) ELSE 0 END), 0) as actual
FROM categories c
LEFT JOIN budget_items bi ON bi.category_id = c.id
  AND bi.budget_plan_id = (
    SELECT id FROM budget_plans
    WHERE user_id = $1 AND month = $2 AND year = $3
  )
LEFT JOIN transactions t ON t.category_id = c.id
  AND EXTRACT(YEAR FROM t.transaction_date) = $3
  AND EXTRACT(MONTH FROM t.transaction_date) = $2
  AND t.deleted_at IS NULL
  AND t.user_id = $1
WHERE c.user_id = $1 AND c.is_active = true
GROUP BY c.id, c.name, c.color, bi.planned_amount
ORDER BY c.name;
```

### Get monthly spending trend (last 6 months)

```sql
SELECT
  EXTRACT(YEAR FROM transaction_date) as year,
  EXTRACT(MONTH FROM transaction_date) as month,
  SUM(CASE WHEN is_income = false THEN ABS(amount) ELSE 0 END) as total_spent,
  SUM(CASE WHEN is_income = true THEN amount ELSE 0 END) as total_income
FROM transactions
WHERE user_id = $1
  AND deleted_at IS NULL
  AND transaction_date >= CURRENT_DATE - INTERVAL '6 months'
GROUP BY year, month
ORDER BY year DESC, month DESC;
```

---

## Context Management Notes

**When asking AI to generate code referencing this data model:**

✅ **DO:**

- Reference this document explicitly: "Using the data model in DATA_MODEL.md, generate..."
- Specify the exact tables/columns needed
- Include TypeScript types when generating React components
- Mention if you're working with cents vs dollars

❌ **DON'T:**

- Assume AI "knows" the schema without showing it
- Mix different naming conventions (stick to snake_case for DB, camelCase for TS)
- Generate queries without specifying which indexes to use
- Skip RLS considerations

**Example good prompt:**

> "Using the `transactions` table from DATA_MODEL.md, write a Supabase query to fetch all transactions for the current month. Return TypeScript `Transaction[]` type."

**Example bad prompt:**

> "Write a query to get transactions"
> _(AI will hallucinate field names)_

---

## Current Schema Summary

All tables are fully implemented and live.

| Script                                      | Purpose                                                                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `sql_scripts/supabase_schema_create.sql`    | Creates all tables, indexes, and RLS policies from scratch on a new project                          |
| `sql_scripts/supabase_rls_complete.sql`     | Idempotently re-applies RLS policies to an existing database (safe to re-run)                        |
| `sql_scripts/supabase_split_expenses.sql`   | Creates partnerships, split_expenses tables, **and** `get_partner_email` RPC (run after main schema) |
| `sql_scripts/supabase_partner_email_fn.sql` | Standalone migration — adds `get_partner_email` RPC to an **existing** database                      |

| Table                 | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `categories`          | Budget categories with type groups and drag-and-drop sort       |
| `user_preferences`    | Per-user UI preferences (JSONB key/value)                       |
| `budget_plans`        | Monthly budget plans (one per user per month/year)              |
| `budget_items`        | Per-category allocations within a plan                          |
| `accounts`            | Financial accounts for net worth tracking                       |
| `transactions`        | Actual income/expense transactions with soft deletes            |
| `recurring_templates` | Templates for recurring transactions with group/child hierarchy |
| `partnerships`        | 2-person partnership links for shared expense splitting         |
| `split_expenses`      | Shared expense ledger entries within a partnership              |

---

**Document version**: 1.5  
**Last updated**: March 8, 2026  
**Owner**: @SamGunvalson
