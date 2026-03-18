-- =============================================================================
-- RLS Policy Audit & Enforcement Script
-- Run in the Supabase SQL Editor to verify and (re-)apply all Row-Level
-- Security policies.  Every statement uses CREATE POLICY IF NOT EXISTS so
-- it is safe to re-run at any time without error.
--
-- Security invariant this script enforces:
--   Every table that holds user data must:
--     1. Have RLS ENABLED.
--     2. Have a policy whose USING clause checks `auth.uid() = user_id`.
--
-- After running, verify all policies with the diagnostic query at the bottom.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- transactions
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'transactions'
      AND policyname = 'Users can manage their own transactions'
  ) THEN
    CREATE POLICY "Users can manage their own transactions"
      ON transactions
      FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- accounts  (policy already created by supabase_migration_accounts.sql —
--            included here for completeness and idempotency)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'accounts'
      AND policyname = 'Users can manage their own accounts'
  ) THEN
    CREATE POLICY "Users can manage their own accounts"
      ON accounts
      FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- categories
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'categories'
      AND policyname = 'Users can manage their own categories'
  ) THEN
    CREATE POLICY "Users can manage their own categories"
      ON categories
      FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- budget_plans
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE budget_plans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'budget_plans'
      AND policyname = 'Users can manage their own budget plans'
  ) THEN
    CREATE POLICY "Users can manage their own budget plans"
      ON budget_plans
      FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- budget_items  (scoped to plans owned by the current user via a sub-select)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE budget_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'budget_items'
      AND policyname = 'Users can manage their own budget items'
  ) THEN
    CREATE POLICY "Users can manage their own budget items"
      ON budget_items
      FOR ALL
      USING (
        budget_plan_id IN (
          SELECT id FROM budget_plans WHERE user_id = auth.uid()
        )
      );
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- recurring_templates
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE recurring_templates ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'recurring_templates'
      AND policyname = 'Users can manage their own recurring templates'
  ) THEN
    CREATE POLICY "Users can manage their own recurring templates"
      ON recurring_templates
      FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- user_preferences
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'user_preferences'
      AND policyname = 'Users can manage their own preferences'
  ) THEN
    CREATE POLICY "Users can manage their own preferences"
      ON user_preferences
      FOR ALL
      USING (auth.uid() = user_id);
  END IF;
END $$;


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

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'partnerships'
      AND policyname = 'Users can create partnership invites'
  ) THEN
    CREATE POLICY "Users can create partnership invites"
      ON partnerships FOR INSERT
      WITH CHECK (auth.uid() = user_a_id);
  END IF;
END $$;

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

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'split_expenses'
      AND policyname = 'Members can view split expenses'
  ) THEN
    CREATE POLICY "Members can view split expenses"
      ON split_expenses FOR SELECT
      USING (
        partnership_id IN (
          SELECT id FROM partnerships
          WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
            AND status = 'active'
        )
        AND deleted_at IS NULL
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'split_expenses'
      AND policyname = 'Members can insert split expenses'
  ) THEN
    CREATE POLICY "Members can insert split expenses"
      ON split_expenses FOR INSERT
      WITH CHECK (
        partnership_id IN (
          SELECT id FROM partnerships
          WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
            AND status = 'active'
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'split_expenses'
      AND policyname = 'Members can update split expenses'
  ) THEN
    CREATE POLICY "Members can update split expenses"
      ON split_expenses FOR UPDATE
      USING (
        partnership_id IN (
          SELECT id FROM partnerships
          WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
            AND status = 'active'
        )
        AND deleted_at IS NULL
      )
      WITH CHECK (
        partnership_id IN (
          SELECT id FROM partnerships
          WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
            AND status = 'active'
        )
      );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'split_expenses'
      AND policyname = 'Members can delete split expenses'
  ) THEN
    CREATE POLICY "Members can delete split expenses"
      ON split_expenses FOR DELETE
      USING (
        partnership_id IN (
          SELECT id FROM partnerships
          WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
            AND status = 'active'
        )
      );
  END IF;
END $$;


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
