-- =============================================================================
-- Budget App — Full Schema Creation Script
-- Run this in the Supabase SQL Editor to create all tables from scratch on a
-- fresh Supabase project.
--
-- Prerequisites:
--   • New Supabase project with auth.users already managed by Supabase Auth.
--   • Run the statements in order — foreign key dependencies are respected.
--
-- After running this script, optionally run supabase_rls_complete.sql to
-- verify that all RLS policies are in place (they are created here, but that
-- script lets you re-apply them idempotently at any time).
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. categories
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE categories (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  type       TEXT        NOT NULL CHECK (type IN ('income', 'needs', 'wants', 'savings', 'transfer')),
  color      VARCHAR(7)  DEFAULT '#3B82F6',
  icon       TEXT,
  is_active  BOOLEAN     DEFAULT TRUE,
  sort_order INTEGER     DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, name, is_active)
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own categories"
  ON categories FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_categories_user
  ON categories(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_categories_sort
  ON categories(user_id, type, sort_order) WHERE is_active = TRUE;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. user_preferences
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE user_preferences (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key   TEXT        NOT NULL,
  preference_value JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, preference_key)
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own preferences"
  ON user_preferences FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. budget_plans
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE budget_plans (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month        INT         NOT NULL CHECK (month BETWEEN 1 AND 12),
  year         INT         NOT NULL CHECK (year >= 2020 AND year <= 2100),
  name         TEXT,
  total_income BIGINT      DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, month, year)
);

ALTER TABLE budget_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own budget plans"
  ON budget_plans FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_budget_plans_user_date
  ON budget_plans(user_id, year DESC, month DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. budget_items
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE budget_items (
  id             UUID   PRIMARY KEY DEFAULT uuid_generate_v4(),
  budget_plan_id UUID   NOT NULL REFERENCES budget_plans(id) ON DELETE CASCADE,
  category_id    UUID   NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  planned_amount BIGINT NOT NULL CHECK (planned_amount >= 0),
  notes          TEXT,
  UNIQUE (budget_plan_id, category_id)
);

ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own budget items"
  ON budget_items FOR ALL
  USING (
    budget_plan_id IN (
      SELECT id FROM budget_plans WHERE user_id = auth.uid()
    )
  );

CREATE INDEX idx_budget_items_plan     ON budget_items(budget_plan_id);
CREATE INDEX idx_budget_items_category ON budget_items(category_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. accounts
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE accounts (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  type            TEXT        NOT NULL CHECK (type IN (
                                  'checking', 'savings', 'credit_card',
                                  'retirement', 'brokerage', 'loan', 'mortgage'
                                )),
  starting_balance BIGINT     DEFAULT 0,
  is_active       BOOLEAN     DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own accounts"
  ON accounts FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX        idx_accounts_user      ON accounts(user_id) WHERE is_active = TRUE;
CREATE UNIQUE INDEX idx_accounts_user_name ON accounts(user_id, name) WHERE is_active = TRUE;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. transactions
--    Note: recurring_template_id FK is added in step 8 after recurring_templates
--    exists. The column is created here as a plain UUID so transactions can be
--    inserted before recurring_templates is populated.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE transactions (
  id                     UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id             UUID        NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id            UUID        NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount                 BIGINT      NOT NULL CHECK (amount != 0),
  description            TEXT        NOT NULL,
  payee                  TEXT,
  transaction_date       DATE        NOT NULL,
  is_income              BOOLEAN     DEFAULT FALSE,
  transfer_group_id      UUID,
  status                 TEXT        NOT NULL DEFAULT 'posted'
                           CHECK (status IN ('projected', 'pending', 'posted')),
  recurring_template_id  UUID,       -- FK added below in step 8
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW(),
  deleted_at             TIMESTAMPTZ
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- Split policies so soft-delete UPDATEs (setting deleted_at) are allowed.
CREATE POLICY "Users can view their own active transactions"
  ON transactions FOR SELECT
  USING (auth.uid() = user_id AND deleted_at IS NULL);

CREATE POLICY "Users can insert their own transactions"
  ON transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own transactions"
  ON transactions FOR UPDATE
  USING  (auth.uid() = user_id AND deleted_at IS NULL)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own transactions"
  ON transactions FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_transactions_user_date
  ON transactions(user_id, transaction_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_category
  ON transactions(category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_account
  ON transactions(account_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_transfer_group
  ON transactions(transfer_group_id)
  WHERE transfer_group_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_transactions_user_month
  ON transactions(user_id,
    EXTRACT(YEAR  FROM transaction_date),
    EXTRACT(MONTH FROM transaction_date))
  WHERE deleted_at IS NULL;
CREATE INDEX idx_transactions_status
  ON transactions(user_id, status, transaction_date);


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. recurring_templates
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE recurring_templates (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id       UUID        NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  category_id      UUID        NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  description      TEXT        NOT NULL,
  payee            TEXT,
  amount           BIGINT      NOT NULL,
  is_income        BOOLEAN     DEFAULT FALSE,
  is_transfer      BOOLEAN     DEFAULT FALSE,
  to_account_id    UUID        REFERENCES accounts(id) ON DELETE SET NULL,
  frequency        TEXT        NOT NULL
                     CHECK (frequency IN (
                       'weekly', 'biweekly', 'semi_monthly',
                       'monthly', 'quarterly', 'yearly'
                     )),
  day_of_month     INT         CHECK (day_of_month  IS NULL OR day_of_month  BETWEEN 1 AND 31),
  day_of_month_2   INT         CHECK (day_of_month_2 IS NULL OR day_of_month_2 BETWEEN 1 AND 31),
  day_of_week      INT         CHECK (day_of_week   IS NULL OR day_of_week   BETWEEN 0 AND 6),
  start_date       DATE        NOT NULL,
  end_date         DATE,
  last_applied     DATE,
  group_id         UUID        REFERENCES recurring_templates(id) ON DELETE CASCADE,
  is_group_parent  BOOLEAN     DEFAULT FALSE,
  group_order      INT         DEFAULT 0,
  auto_confirm     BOOLEAN     NOT NULL DEFAULT TRUE,
  projected_through DATE,
  is_active        BOOLEAN     DEFAULT TRUE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT transfer_needs_to_account CHECK (is_transfer = FALSE OR to_account_id IS NOT NULL)
);

ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own recurring templates"
  ON recurring_templates FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX idx_recurring_templates_user
  ON recurring_templates(user_id) WHERE is_active = TRUE;
CREATE INDEX idx_recurring_templates_group
  ON recurring_templates(group_id)
  WHERE group_id IS NOT NULL AND is_active = TRUE;
CREATE INDEX idx_recurring_templates_to_account
  ON recurring_templates(to_account_id) WHERE to_account_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Back-fill FK: transactions → recurring_templates
--    Also add the dedup unique index that prevents duplicate projected
--    transactions for the same template + date + account.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE transactions
  ADD CONSTRAINT fk_transactions_recurring_template
  FOREIGN KEY (recurring_template_id)
  REFERENCES recurring_templates(id) ON DELETE SET NULL;

-- Prevents duplicate projected/pending/posted transactions per template per
-- date. account_id is included because transfer templates create two legs
-- (source + destination) that share recurring_template_id and transaction_date
-- but use different accounts.
CREATE UNIQUE INDEX idx_transactions_no_dup_recurring
  ON transactions(recurring_template_id, transaction_date, account_id)
  WHERE recurring_template_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX idx_transactions_recurring_template
  ON transactions(recurring_template_id, transaction_date)
  WHERE recurring_template_id IS NOT NULL;


-- =============================================================================
-- Verification query — run after the script to confirm all tables were created
-- and RLS is enabled.
-- =============================================================================
SELECT
  c.relname                                   AS table_name,
  c.relrowsecurity                            AS rls_enabled,
  COALESCE(
    string_agg(p.policyname, ', ' ORDER BY p.policyname),
    '⚠  NO POLICIES FOUND'
  )                                           AS policies
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p
  ON p.tablename = c.relname AND p.schemaname = n.nspname
WHERE n.nspname = 'public'
  AND c.relkind  = 'r'
  AND c.relname IN (
    'categories', 'user_preferences',
    'budget_plans', 'budget_items',
    'accounts', 'transactions',
    'recurring_templates'
  )
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
