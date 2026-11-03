-- =============================================================================
-- Split Expenses — Deduplicate transaction-linked rows
--
-- Fixes historical duplicate split_expenses rows for the same transaction_id and
-- adds a DB-level uniqueness guarantee for active rows.
--
-- Run this on EXISTING databases that already have split_expenses data.
-- =============================================================================

-- Soft-delete duplicate active rows, keeping the earliest created row per
-- transaction_id (ties broken by id).
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY transaction_id
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM split_expenses
  WHERE transaction_id IS NOT NULL
    AND deleted_at IS NULL
)
UPDATE split_expenses se
SET deleted_at = NOW()
FROM ranked r
WHERE se.id = r.id
  AND r.rn > 1
  AND se.deleted_at IS NULL;

-- Enforce one active split-expense row per linked transaction.
CREATE UNIQUE INDEX IF NOT EXISTS idx_split_expenses_one_active_per_transaction
  ON split_expenses(transaction_id)
  WHERE transaction_id IS NOT NULL
    AND deleted_at IS NULL;
