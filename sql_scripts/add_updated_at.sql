-- =============================================================================
-- Add `updated_at` to tables that don't have it yet, so the incremental sync
-- watermark in src/services/sync.js (`.gt('updated_at', last_synced)`) works
-- across every synced table.
--
-- Affected tables: categories, budget_items, recurring_templates.
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


-- 3. Attach the trigger to each table.  Drop-then-create to stay idempotent.

DROP TRIGGER IF EXISTS trg_categories_updated_at ON categories;
CREATE TRIGGER trg_categories_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_budget_items_updated_at ON budget_items;
CREATE TRIGGER trg_budget_items_updated_at
  BEFORE UPDATE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_recurring_templates_updated_at ON recurring_templates;
CREATE TRIGGER trg_recurring_templates_updated_at
  BEFORE UPDATE ON recurring_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 4. Verification.

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'updated_at'
  AND table_name IN ('categories', 'budget_items', 'recurring_templates')
ORDER BY table_name;
