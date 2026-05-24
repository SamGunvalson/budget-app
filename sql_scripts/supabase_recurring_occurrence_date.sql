-- =============================================================================
-- Migration: Add recurring_occurrence_date to transactions
--
-- Problem: When a projected/pending transaction's date is edited by the user
-- (e.g., moved from the 25th to the 22nd when it occurs early), the
-- transaction_date changes. The next generateProjectedTransactions() run
-- builds a dedup set keyed by recurring_template_id|transaction_date, so the
-- original scheduled occurrence date (25th) is no longer present — causing a
-- brand-new projection to be created for that date in perpetuity.
--
-- Fix: Add recurring_occurrence_date, which records the originally-scheduled
-- occurrence date from the template and is never changed when the user edits
-- the transaction. The dedup logic and uniqueness constraint use this field.
-- =============================================================================

-- 1. Add the new column (nullable so existing rows are unaffected until backfill)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS recurring_occurrence_date DATE;

-- 2. Backfill existing recurring transactions: treat their current
--    transaction_date as the original occurrence date (best approximation
--    for records created before this migration).
UPDATE transactions
SET recurring_occurrence_date = transaction_date
WHERE recurring_template_id IS NOT NULL
  AND recurring_occurrence_date IS NULL
  AND deleted_at IS NULL;

-- 3. Drop the old unique index that was keyed on transaction_date.
--    (Users editing a transaction date would hit this constraint incorrectly.)
DROP INDEX IF EXISTS idx_transactions_no_dup_recurring;

-- 4. Create new unique partial index keyed on recurring_occurrence_date.
--    This ensures at most one active transaction per template per scheduled
--    occurrence date per account. account_id is included because transfer
--    templates legitimately create two legs (source + destination) sharing the
--    same recurring_template_id and recurring_occurrence_date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_no_dup_recurring
  ON transactions(recurring_template_id, recurring_occurrence_date, account_id)
  WHERE recurring_template_id IS NOT NULL
    AND recurring_occurrence_date IS NOT NULL
    AND deleted_at IS NULL;

-- 5. Keep (or recreate) the non-unique lookup index for generation queries.
--    This index is unchanged — still useful for range queries by template.
CREATE INDEX IF NOT EXISTS idx_transactions_recurring_occurrence
  ON transactions(recurring_template_id, recurring_occurrence_date)
  WHERE recurring_template_id IS NOT NULL AND recurring_occurrence_date IS NOT NULL;
