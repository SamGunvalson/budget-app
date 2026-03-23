-- =============================================================================
-- Migration: Closed Accounts + Recurring Template Pausing
--
-- Adds:
--   • accounts.closed_at          — NULL = open, DATE = closed on that date
--   • recurring_templates.is_paused — TRUE = paused (skipped during generation)
--
-- Safe to re-run (uses IF NOT EXISTS / conditional adds).
-- =============================================================================

-- 1. Add closed_at to accounts
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS closed_at DATE DEFAULT NULL;

-- 2. Add is_paused to recurring_templates
ALTER TABLE recurring_templates
  ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT FALSE;
