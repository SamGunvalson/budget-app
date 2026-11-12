-- =============================================================================
-- Partnership and split-expense RLS hardening (existing databases)
--
-- Problems fixed:
--   1. The partnerships INSERT policy only required user_a_id = auth.uid(), so
--      a user could insert an already-active partnership with any user_b_id.
--   2. The partnerships UPDATE policy let either member reactivate a dissolved
--      partnership or rewrite member ids / invited_email.
--   3. Nothing stopped a user from being in two active partnerships, which
--      breaks the single-partnership assumption in the app.
--   4. split_expenses INSERT only checked membership: paid_by_user_id did not
--      have to be a partner and transaction_id could point at any transaction.
--      UPDATE could also re-point partnership_id / transaction_id.
--
-- Effects are already included in supabase_split_expenses.sql and
-- supabase_rls_complete.sql for fresh installs. Do NOT run this on a fresh
-- database. Safe to re-run. Runs in one transaction.
--
-- If this script stops with "Users in more than one active partnership",
-- dissolve the extra partnerships first (as the database owner), then re-run.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_dupes TEXT;
BEGIN
  SELECT string_agg(member_id::text, ', ') INTO v_dupes
  FROM (
    SELECT member_id
    FROM (
      SELECT user_a_id AS member_id FROM public.partnerships WHERE status = 'active'
      UNION ALL
      SELECT user_b_id FROM public.partnerships
      WHERE status = 'active' AND user_b_id IS NOT NULL
    ) members
    GROUP BY member_id
    HAVING count(*) > 1
  ) dupes;
  IF v_dupes IS NOT NULL THEN
    RAISE EXCEPTION 'Users in more than one active partnership: %', v_dupes;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partnerships_one_active_user_a
  ON partnerships (user_a_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_partnerships_one_active_user_b
  ON partnerships (user_b_id) WHERE status = 'active';

-- ─────────────────────────────────────────────────────────────────────────────
-- Partnership integrity guard
-- ─────────────────────────────────────────────────────────────────────────────
-- RLS alone cannot compare OLD and NEW, so this trigger enforces what the
-- policies cannot:
--   • identity columns (id, user_a_id, invited_email, created_at) are frozen;
--   • the only status transitions are pending → active (accept, by the invited
--     user, who becomes user_b_id) and active → dissolved;
--   • user_b_id changes only as part of an accept;
--   • a pending invitee can accept but not otherwise write to the row;
--   • a user can be a member of at most one active partnership.
-- Calls without an end-user identity (database owner, service role, data
-- migration) skip the transition rules but not the one-active-partnership rule.
-- SECURITY DEFINER is required so the membership check can see partnerships
-- the caller is not a member of.
CREATE OR REPLACE FUNCTION public.partnerships_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT := lower(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email');
  v_becomes_active BOOLEAN := FALSE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF v_uid IS NOT NULL THEN
      IF NEW.id IS DISTINCT FROM OLD.id
         OR NEW.user_a_id IS DISTINCT FROM OLD.user_a_id
         OR NEW.invited_email IS DISTINCT FROM OLD.invited_email
         OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Partnership identity columns cannot be changed'
          USING ERRCODE = '42501';
      END IF;

      -- A pending invitee may only accept; other writes are for members.
      IF v_uid IS DISTINCT FROM OLD.user_a_id
         AND v_uid IS DISTINCT FROM OLD.user_b_id
         AND NOT (OLD.status = 'pending' AND NEW.status = 'active') THEN
        RAISE EXCEPTION 'Only partnership members can update a partnership'
          USING ERRCODE = '42501';
      END IF;

      IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF OLD.status = 'pending' AND NEW.status = 'active' THEN
          IF OLD.user_b_id IS NOT NULL
             OR NEW.user_b_id IS DISTINCT FROM v_uid
             OR v_uid = OLD.user_a_id
             OR v_email IS NULL
             OR lower(OLD.invited_email) <> v_email THEN
            RAISE EXCEPTION 'Only the invited user can accept this invite'
              USING ERRCODE = '42501';
          END IF;
        ELSIF OLD.status = 'active' AND NEW.status = 'dissolved' THEN
          IF NEW.user_b_id IS DISTINCT FROM OLD.user_b_id THEN
            RAISE EXCEPTION 'Partnership members cannot be changed'
              USING ERRCODE = '42501';
          END IF;
        ELSE
          RAISE EXCEPTION 'Invalid partnership status change: % to %', OLD.status, NEW.status
            USING ERRCODE = '42501';
        END IF;
      ELSIF NEW.user_b_id IS DISTINCT FROM OLD.user_b_id THEN
        RAISE EXCEPTION 'Partnership members cannot be changed'
          USING ERRCODE = '42501';
      END IF;
    END IF;

    v_becomes_active := NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active';
  ELSE
    v_becomes_active := NEW.status = 'active';
  END IF;

  IF v_becomes_active THEN
    -- Serialise concurrent accepts involving either user (fixed lock order).
    PERFORM pg_advisory_xact_lock(hashtextextended(LEAST(NEW.user_a_id, NEW.user_b_id)::text, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended(GREATEST(NEW.user_a_id, NEW.user_b_id)::text, 0));
    IF EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.status = 'active'
        AND p.id <> NEW.id
        AND (p.user_a_id IN (NEW.user_a_id, NEW.user_b_id)
          OR p.user_b_id IN (NEW.user_a_id, NEW.user_b_id))
    ) THEN
      RAISE EXCEPTION 'A user can only be in one active partnership'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.partnerships_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_partnerships_guard ON partnerships;
CREATE TRIGGER trg_partnerships_guard
  BEFORE INSERT OR UPDATE ON partnerships
  FOR EACH ROW EXECUTE FUNCTION public.partnerships_guard();

DROP POLICY IF EXISTS "Users can create partnership invites" ON partnerships;
CREATE POLICY "Users can create partnership invites"
  ON partnerships FOR INSERT
  WITH CHECK (
    auth.uid() = user_a_id
    AND status = 'pending'
    AND user_b_id IS NULL
  );

DROP POLICY IF EXISTS "Members can insert split expenses" ON split_expenses;
CREATE POLICY "Members can insert split expenses"
  ON split_expenses FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.id = split_expenses.partnership_id
        AND p.status = 'active'
        AND auth.uid() IN (p.user_a_id, p.user_b_id)
        AND split_expenses.paid_by_user_id IN (p.user_a_id, p.user_b_id)
    )
    AND (
      split_expenses.transaction_id IS NULL
      OR EXISTS (
        SELECT 1 FROM transactions t
        WHERE t.id = split_expenses.transaction_id AND t.user_id = auth.uid()
      )
    )
  );

-- USING keeps deleted_at IS NULL; WITH CHECK must not (soft-delete writes).
DROP POLICY IF EXISTS "Members can update split expenses" ON split_expenses;
CREATE POLICY "Members can update split expenses"
  ON split_expenses FOR UPDATE
  USING (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
    AND deleted_at IS NULL
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM partnerships p
      WHERE p.id = split_expenses.partnership_id
        AND auth.uid() IN (p.user_a_id, p.user_b_id)
        AND split_expenses.paid_by_user_id IN (p.user_a_id, p.user_b_id)
    )
  );

-- Split-expense link guard: RLS cannot compare OLD and NEW, so this trigger
-- freezes partnership_id and transaction_id for end users. Clearing
-- transaction_id stays allowed (the ON DELETE SET NULL action on the
-- transactions FK runs with the deleting user's identity).
CREATE OR REPLACE FUNCTION public.split_expenses_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.partnership_id IS DISTINCT FROM OLD.partnership_id THEN
      RAISE EXCEPTION 'A split expense cannot be moved to another partnership'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.transaction_id IS NOT NULL
       AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
      RAISE EXCEPTION 'The linked transaction of a split expense cannot be changed'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.split_expenses_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_split_expenses_guard ON split_expenses;
CREATE TRIGGER trg_split_expenses_guard
  BEFORE UPDATE ON split_expenses
  FOR EACH ROW EXECUTE FUNCTION public.split_expenses_guard();

COMMIT;
