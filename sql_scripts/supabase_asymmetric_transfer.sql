-- Migration: Add to_amount column to recurring_templates
-- Supports asymmetric transfers where the outgoing and incoming legs
-- have different amounts (e.g. a loan payment where only the principal
-- portion is credited to the destination account).
--
-- When non-null on a transfer template (is_transfer = TRUE), the incoming
-- leg uses to_amount instead of amount, allowing the difference to represent
-- interest, fees, or other costs that do not credit any tracked account.

ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS to_amount BIGINT DEFAULT NULL;

-- Constraint: to_amount must be positive when set.
-- No restriction on is_transfer — linked transfer templates (is_transfer = FALSE) also use to_amount.
ALTER TABLE recurring_templates
  DROP CONSTRAINT IF EXISTS recurring_templates_to_amount_check;

ALTER TABLE recurring_templates
  ADD CONSTRAINT recurring_templates_to_amount_check
  CHECK (to_amount IS NULL OR to_amount > 0);
