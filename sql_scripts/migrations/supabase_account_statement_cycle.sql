-- =============================================================================
-- Migration: Credit card statement cycle on accounts
--
-- Adds:
--   • accounts.statement_close_day  — day of month the statement closes (1-31)
--   • accounts.payment_due_day      — day of month the payment is due (1-31)
--   • accounts.payment_account_id   — account that pays the statement
-- and replaces get_account_balances so it returns the new columns (its
-- RETURNS TABLE shape changes, so the function is dropped and recreated).
--
-- Safe to re-run. Run as the database owner before deploying the updated
-- frontend. Current setup equivalent: core base + phase-3 aggregations.
-- =============================================================================
BEGIN;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS statement_close_day INT
    CHECK (statement_close_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS payment_due_day INT
    CHECK (payment_due_day BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS payment_account_id UUID
    REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS accounts_payment_account_not_self;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_payment_account_not_self
    CHECK (payment_account_id IS NULL OR payment_account_id <> id);

DROP FUNCTION IF EXISTS get_account_balances(date);

CREATE OR REPLACE FUNCTION get_account_balances(p_projected_to_date date DEFAULT NULL)
RETURNS TABLE (
  id                 uuid,
  user_id            uuid,
  name               text,
  type               text,
  starting_balance   bigint,
  is_active          boolean,
  closed_at          date,
  statement_close_day integer,
  payment_due_day    integer,
  payment_account_id uuid,
  created_at         timestamptz,
  updated_at         timestamptz,
  transaction_net    bigint,
  balance            bigint,
  pending_net        bigint,
  projected_balance  bigint,
  is_asset           boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH today AS (SELECT CURRENT_DATE AS d),
  sums AS (
    SELECT
      t.account_id,
      -- Posted, on/before today → actual balance
      COALESCE(SUM(CASE
        WHEN t.status = 'posted' AND t.transaction_date <= today.d AND t.is_income
          THEN ABS(t.amount) END), 0) AS posted_income,
      COALESCE(SUM(CASE
        WHEN t.status = 'posted' AND t.transaction_date <= today.d AND NOT t.is_income
          THEN ABS(t.amount) END), 0) AS posted_expense,
      -- Pending → near-term projection
      COALESCE(SUM(CASE
        WHEN t.status = 'pending' AND t.is_income
          THEN ABS(t.amount) END), 0) AS pending_income,
      COALESCE(SUM(CASE
        WHEN t.status = 'pending' AND NOT t.is_income
          THEN ABS(t.amount) END), 0) AS pending_expense,
      -- Future projected: status=projected OR status=posted with future date,
      -- both capped by p_projected_to_date when supplied.
      COALESCE(SUM(CASE
        WHEN (
              t.status = 'projected'
              OR (t.status = 'posted' AND t.transaction_date > today.d)
            )
            AND t.is_income
            AND (p_projected_to_date IS NULL OR t.transaction_date <= p_projected_to_date)
          THEN ABS(t.amount) END), 0) AS projected_income,
      COALESCE(SUM(CASE
        WHEN (
              t.status = 'projected'
              OR (t.status = 'posted' AND t.transaction_date > today.d)
            )
            AND NOT t.is_income
            AND (p_projected_to_date IS NULL OR t.transaction_date <= p_projected_to_date)
          THEN ABS(t.amount) END), 0) AS projected_expense
    FROM transactions t CROSS JOIN today
    WHERE t.user_id = auth.uid()
      AND t.deleted_at IS NULL
    GROUP BY t.account_id
  )
  SELECT
    a.id,
    a.user_id,
    a.name,
    a.type,
    a.starting_balance,
    a.is_active,
    a.closed_at,
    a.statement_close_day,
    a.payment_due_day,
    a.payment_account_id,
    a.created_at,
    a.updated_at,
    -- transaction_net (posted)
    CASE WHEN _is_asset_account(a.type)
      THEN COALESCE(s.posted_income, 0)  - COALESCE(s.posted_expense, 0)
      ELSE COALESCE(s.posted_expense, 0) - COALESCE(s.posted_income, 0)
    END AS transaction_net,
    -- balance = starting + posted_net
    a.starting_balance +
      CASE WHEN _is_asset_account(a.type)
        THEN COALESCE(s.posted_income, 0)  - COALESCE(s.posted_expense, 0)
        ELSE COALESCE(s.posted_expense, 0) - COALESCE(s.posted_income, 0)
      END AS balance,
    -- pending_net
    CASE WHEN _is_asset_account(a.type)
      THEN COALESCE(s.pending_income, 0)  - COALESCE(s.pending_expense, 0)
      ELSE COALESCE(s.pending_expense, 0) - COALESCE(s.pending_income, 0)
    END AS pending_net,
    -- projected_balance: closed accounts freeze at posted balance
    CASE WHEN a.closed_at IS NOT NULL THEN
      a.starting_balance +
        CASE WHEN _is_asset_account(a.type)
          THEN COALESCE(s.posted_income, 0)  - COALESCE(s.posted_expense, 0)
          ELSE COALESCE(s.posted_expense, 0) - COALESCE(s.posted_income, 0)
        END
    ELSE
      a.starting_balance
        + CASE WHEN _is_asset_account(a.type)
            THEN COALESCE(s.posted_income, 0)    - COALESCE(s.posted_expense, 0)
            ELSE COALESCE(s.posted_expense, 0)   - COALESCE(s.posted_income, 0) END
        + CASE WHEN _is_asset_account(a.type)
            THEN COALESCE(s.pending_income, 0)   - COALESCE(s.pending_expense, 0)
            ELSE COALESCE(s.pending_expense, 0)  - COALESCE(s.pending_income, 0) END
        + CASE WHEN _is_asset_account(a.type)
            THEN COALESCE(s.projected_income, 0) - COALESCE(s.projected_expense, 0)
            ELSE COALESCE(s.projected_expense, 0)- COALESCE(s.projected_income, 0) END
    END AS projected_balance,
    _is_asset_account(a.type) AS is_asset
  FROM accounts a
  LEFT JOIN sums s ON s.account_id = a.id
  WHERE a.user_id = auth.uid()
    AND a.is_active = TRUE
  ORDER BY a.type, a.name;
$$;

-- DROP FUNCTION discards existing EXECUTE grants. Re-grant explicitly so the
-- upgrade does not depend on which role runs it (self-hosted default
-- privileges only cover objects created by the role that set them).
GRANT EXECUTE ON FUNCTION get_account_balances(date) TO authenticated;

-- PostgREST caches table and RPC shapes; reload so the new columns resolve.
NOTIFY pgrst, 'reload schema';

COMMIT;
