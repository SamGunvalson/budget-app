-- =============================================================================
-- RLS Policy Audit & Enforcement Script
-- Run in the Supabase SQL Editor to verify and (re-)apply all Row-Level
-- Security policies. Policies are dropped and recreated so re-running also
-- corrects existing definitions. All replacements are applied atomically.
-- Existing databases must first apply supabase_transactions_soft_delete_rls.sql
-- to ensure the soft-delete RPC exists before tightening transaction visibility.
--
-- Security invariant this script enforces:
--   Every table that holds user data must:
--     1. Have RLS ENABLED.
--     2. Have a policy whose USING clause checks `auth.uid() = user_id`.
--
-- After running, verify all policies with the diagnostic query at the bottom.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- transactions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own transactions" ON transactions;

DROP POLICY IF EXISTS "Users can view their own active transactions" ON transactions;
CREATE POLICY "Users can view their own active transactions"
  ON transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Users can insert their own transactions" ON transactions;
CREATE POLICY "Users can insert their own transactions"
  ON transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own transactions" ON transactions;
CREATE POLICY "Users can update their own transactions"
  ON transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND deleted_at IS NULL)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own transactions" ON transactions;
CREATE POLICY "Users can delete their own transactions"
  ON transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- accounts  (policy already created by supabase_migration_accounts.sql —
--            included here for completeness and idempotency)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own accounts" ON accounts;
CREATE POLICY "Users can manage their own accounts"
  ON accounts FOR ALL
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- categories
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own categories" ON categories;
CREATE POLICY "Users can manage their own categories"
  ON categories FOR ALL
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- budget_plans
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE budget_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own budget plans" ON budget_plans;
CREATE POLICY "Users can manage their own budget plans"
  ON budget_plans FOR ALL
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- budget_items  (scoped to plans owned by the current user via a sub-select)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own budget items" ON budget_items;
CREATE POLICY "Users can manage their own budget items"
  ON budget_items FOR ALL
  USING (
    budget_plan_id IN (
      SELECT id FROM budget_plans WHERE user_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- recurring_templates
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own recurring templates" ON recurring_templates;
CREATE POLICY "Users can manage their own recurring templates"
  ON recurring_templates FOR ALL
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- user_preferences
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own preferences" ON user_preferences;
CREATE POLICY "Users can manage their own preferences"
  ON user_preferences FOR ALL
  USING (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- partnerships
-- NOTE: These policies are dropped and recreated (not IF NOT EXISTS) because
-- an earlier version had a bug where the invitee could not see, accept, or
-- decline pending invites — user_b_id is NULL until acceptance, so the
-- policies must also match by invited_email for the pending state.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE partnerships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their partnerships" ON partnerships;
CREATE POLICY "Members can view their partnerships"
  ON partnerships FOR SELECT
  USING (
    auth.uid() = user_a_id
    OR auth.uid() = user_b_id
    OR (status = 'pending' AND invited_email = (current_setting('request.jwt.claims', true)::jsonb ->> 'email'))
  );

DROP POLICY IF EXISTS "Users can create partnership invites" ON partnerships;
CREATE POLICY "Users can create partnership invites"
  ON partnerships FOR INSERT
  WITH CHECK (auth.uid() = user_a_id);

DROP POLICY IF EXISTS "Members can update their partnerships" ON partnerships;
CREATE POLICY "Members can update their partnerships"
  ON partnerships FOR UPDATE
  USING (
    auth.uid() = user_a_id
    OR auth.uid() = user_b_id
    OR (status = 'pending' AND invited_email = (current_setting('request.jwt.claims', true)::jsonb ->> 'email'))
  )
  WITH CHECK (
    auth.uid() = user_a_id
    OR auth.uid() = user_b_id
    OR (status = 'pending' AND invited_email = (current_setting('request.jwt.claims', true)::jsonb ->> 'email'))
  );

DROP POLICY IF EXISTS "Members can delete their partnerships" ON partnerships;
CREATE POLICY "Members can delete their partnerships"
  ON partnerships FOR DELETE
  USING (
    auth.uid() = user_a_id
    OR auth.uid() = user_b_id
    OR (status = 'pending' AND invited_email = (current_setting('request.jwt.claims', true)::jsonb ->> 'email'))
  );


-- ─────────────────────────────────────────────────────────────────────────────
-- split_expenses
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE split_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view split expenses" ON split_expenses;

CREATE POLICY "Members can view split expenses"
  ON split_expenses FOR SELECT
  USING (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS "Members can insert split expenses" ON split_expenses;
CREATE POLICY "Members can insert split expenses"
  ON split_expenses FOR INSERT
  WITH CHECK (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
        AND status = 'active'
    )
  );

-- DROP + CREATE (not IF NOT EXISTS) so that re-running this script also fixes
-- an incorrect policy that already exists on the database.
-- Key invariant: USING requires deleted_at IS NULL (can only update live rows);
-- WITH CHECK only verifies partnership membership — it must NOT require
-- deleted_at IS NULL, because soft-delete writes intentionally set that column.
DROP POLICY IF EXISTS "Members can update split expenses" ON split_expenses;

CREATE POLICY "Members can update split expenses"
  ON split_expenses FOR UPDATE
  USING (
    deleted_at IS NULL
    AND partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
  )
  WITH CHECK (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
  );

-- DROP + CREATE so re-running this script can correct an existing bad policy.
DROP POLICY IF EXISTS "Members can delete split expenses" ON split_expenses;

CREATE POLICY "Members can delete split expenses"
  ON split_expenses FOR DELETE
  USING (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
  );


COMMIT;

-- =============================================================================
-- Diagnostic query — run this after the script to confirm all tables are
-- protected.  Every row in the result should show rls_enabled = true and
-- have at least one policy listed.
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
LEFT JOIN pg_policies p ON p.tablename = c.relname AND p.schemaname = n.nspname
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'transactions', 'accounts', 'categories',
    'budget_plans', 'budget_items',
    'recurring_templates', 'user_preferences',
    'partnerships', 'split_expenses'
  )
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;
