-- =============================================================================
-- Migration: Statement-driven credit card payments
--
-- Adds:
--   • recurring_templates.pays_statement_balance — a transfer template whose
--     amount comes from the destination card's statement balance and whose
--     schedule follows the card's payment due day.
--   • transactions.amount_locked — set when the user edits the amount of a
--     generated statement payment so recalculation leaves it alone.
--
-- Safe to re-run. Run as the database owner before deploying the updated
-- frontend. Current setup equivalent: core base (supabase_schema_create.sql).
-- =============================================================================
BEGIN;

ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS pays_statement_balance BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE recurring_templates
  DROP CONSTRAINT IF EXISTS statement_payment_is_plain_transfer;
ALTER TABLE recurring_templates
  ADD CONSTRAINT statement_payment_is_plain_transfer CHECK (
    pays_statement_balance = FALSE
    OR (is_transfer = TRUE AND group_id IS NULL AND is_group_parent = FALSE)
  );

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS amount_locked BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
