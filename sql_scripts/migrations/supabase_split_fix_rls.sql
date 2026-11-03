-- =============================================================================
-- Split Expenses — RLS UPDATE/DELETE Policy Fix
--
-- Problem: The original WITH CHECK clause on the split_expenses UPDATE policy
-- did not account for soft-delete writes. After setting deleted_at, the SELECT
-- policy (which requires deleted_at IS NULL) blocks the updated row, causing
-- Supabase to surface a 42501 RLS error instead of a silent 0-row result.
--
-- Some existing databases may also have overly strict split_expenses policies
-- tied to partnership status. This migration re-applies UPDATE/DELETE policies
-- using partnership membership only (either user_a or user_b).
--
-- Fix: The USING clause (input filter) correctly keeps AND deleted_at IS NULL
-- so you can only update non-deleted rows. The WITH CHECK (output filter) is
-- changed to check only partnership membership — it must NOT require
-- deleted_at IS NULL on the *new* row because the whole point of the soft-
-- delete is to set that column.
--
-- Run this in the Supabase SQL Editor after supabase_split_expenses.sql.
-- =============================================================================

DROP POLICY IF EXISTS "Members can update split expenses" ON split_expenses;

CREATE POLICY "Members can update split expenses"
  ON split_expenses FOR UPDATE
  USING (
    -- Only allow updating rows that are not yet deleted and belong to a
    -- partnership the current user is a member of.
    deleted_at IS NULL
    AND partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
  )
  WITH CHECK (
    -- The new row only needs to belong to a partnership — it does NOT
    -- require deleted_at IS NULL here, because soft-deletes set that column.
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Members can delete split expenses" ON split_expenses;

CREATE POLICY "Members can delete split expenses"
  ON split_expenses FOR DELETE
  USING (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
  );
