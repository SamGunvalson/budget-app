-- =============================================================================
-- Migration: Add per-user notification seen timestamps to partnerships
--
-- Run this against an existing database that already has the partnerships table.
-- Safe to re-run (IF NOT EXISTS guards each ADD COLUMN).
-- =============================================================================

ALTER TABLE partnerships
  ADD COLUMN IF NOT EXISTS user_a_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS user_b_seen_at TIMESTAMPTZ;
