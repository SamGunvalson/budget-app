-- =============================================================================
-- Split Recurring Transactions — Migration
--
-- Adds split-expense configuration columns to recurring_templates so that
-- when a recurring transaction is posted (via auto-confirm or manual confirm)
-- a corresponding split_expenses record is created automatically.
--
-- Run this in the Supabase SQL Editor after the base schema is in place.
-- All statements are idempotent (IF NOT EXISTS / IF EXISTS guards).
-- =============================================================================

-- is_split: whether this template should auto-create a split expense on post
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS is_split BOOLEAN NOT NULL DEFAULT FALSE;

-- split_method: how the expense is divided
--   'equal'  → 50/50 split
--   'full'   → the non-payer owes the entire amount
--   'custom' → partner owes split_partner_share_pct % of the total
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS split_method TEXT
    CHECK (split_method IS NULL OR split_method IN ('equal', 'full', 'custom'));

-- split_payer: who pays the expense ('me' = logged-in user, 'partner')
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS split_payer TEXT
    CHECK (split_payer IS NULL OR split_payer IN ('me', 'partner'));

-- split_partner_share_pct: partner's share percentage (0–100)
--   Only relevant when split_method = 'custom'.
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS split_partner_share_pct INTEGER
    CHECK (split_partner_share_pct IS NULL OR split_partner_share_pct BETWEEN 0 AND 100);
