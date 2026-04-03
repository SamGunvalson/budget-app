-- Migration: Add custom recurring schedule interval support
-- Run this against your Supabase instance (SQL Editor) for existing deployments.
-- For fresh installs, use supabase_schema_create.sql instead.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add new columns for custom interval configuration
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS custom_interval INT
    CHECK (custom_interval IS NULL OR custom_interval >= 1),
  ADD COLUMN IF NOT EXISTS custom_unit TEXT
    CHECK (custom_unit IS NULL OR custom_unit IN ('days', 'weeks', 'months'));

-- 2. Drop the existing frequency CHECK constraint and re-add it with 'custom' included.
--    PostgreSQL auto-names inline column constraints as {table}_{column}_check.
--    If the constraint name differs in your Supabase instance, find it with:
--      SELECT conname FROM pg_constraint WHERE conrelid = 'recurring_templates'::regclass AND contype = 'c';
ALTER TABLE recurring_templates
  DROP CONSTRAINT IF EXISTS recurring_templates_frequency_check;

ALTER TABLE recurring_templates
  ADD CONSTRAINT recurring_templates_frequency_check
    CHECK (frequency IN (
      'weekly', 'biweekly', 'semi_monthly',
      'monthly', 'quarterly', 'yearly',
      'custom'
    ));
