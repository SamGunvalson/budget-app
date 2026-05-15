-- =============================================================================
-- Split Expenses — RLS UPDATE Policy Fix
--
-- Problem: The original WITH CHECK clause on the split_expenses UPDATE policy
-- did not account for soft-delete writes. After setting deleted_at, the SELECT
-- policy (which requires deleted_at IS NULL) blocks the updated row, causing
-- Supabase to surface a 42501 RLS error instead of a silent 0-row result.
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
    -- Only allow updating rows that are not yet deleted AND belong to an
    -- active partnership the current user is a member of.
    deleted_at IS NULL
    AND partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
        AND status = 'active'
    )
  )
  WITH CHECK (
    -- The new row only needs to belong to an active partnership — it does NOT
    -- require deleted_at IS NULL here, because soft-deletes set that column.
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
        AND status = 'active'
    )
  );
