-- =============================================================================
-- Add `updated_at` to tables that don't have it yet, so the incremental sync
-- watermark in src/services/sync.js (`.gt('updated_at', last_synced)`) works
-- across every synced table.
--
-- Columns added: categories, budget_items, recurring_templates.
-- Server-stamping triggers: all seven synced tables.
-- Idempotent — safe to re-run.
-- =============================================================================

-- 1. Add the columns (default NOW() so existing rows get a sane value).

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE budget_items
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Backfill any pre-existing rows where the default didn't apply (e.g. rows
-- inserted before the column existed and the ALTER stamped them all to the
-- same NOW()).  Idempotent: only touches rows that are still NULL.
UPDATE categories          SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL;
UPDATE budget_items        SET updated_at = COALESCE(updated_at, NOW())              WHERE updated_at IS NULL;
UPDATE recurring_templates SET updated_at = COALESCE(updated_at, created_at, NOW()) WHERE updated_at IS NULL;


-- 2. Generic trigger function: stamp updated_at on every UPDATE.
--    Reusable for any future table that needs this behavior.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


-- 3. Attach the trigger to every synced table.  Drop-then-create to stay
--    idempotent.  INSERT is stamped too: incremental sync pulls rows by
--    `updated_at`, so it must be server time — a client clock running behind
--    would otherwise date its writes before other devices' watermarks.

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_categories_updated_at ON categories;
CREATE TRIGGER trg_categories_updated_at
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON accounts;
CREATE TRIGGER trg_accounts_updated_at
  BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_budget_plans_updated_at ON budget_plans;
CREATE TRIGGER trg_budget_plans_updated_at
  BEFORE INSERT OR UPDATE ON budget_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_budget_items_updated_at ON budget_items;
CREATE TRIGGER trg_budget_items_updated_at
  BEFORE INSERT OR UPDATE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE INSERT OR UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_recurring_templates_updated_at ON recurring_templates;
CREATE TRIGGER trg_recurring_templates_updated_at
  BEFORE INSERT OR UPDATE ON recurring_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Incremental transaction pulls filter by owner and order by (updated_at, id).
CREATE INDEX IF NOT EXISTS idx_transactions_user_updated
  ON transactions(user_id, updated_at, id);


-- 4. Verification.

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'updated_at'
  AND table_name IN ('categories', 'budget_items', 'recurring_templates')
ORDER BY table_name;
