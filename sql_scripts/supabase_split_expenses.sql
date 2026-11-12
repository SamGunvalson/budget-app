-- =============================================================================
-- Split Expenses — Schema Creation Script
-- Run this in the Supabase SQL Editor AFTER the main schema script
-- (supabase_schema_create.sql) to add partnership and split expense tables.
--
-- Prerequisites:
--   • Main schema already created (auth.users, transactions table exists)
--   • uuid-ossp extension enabled
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. partnerships
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE partnerships (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_a_id        UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b_id        UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email    TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'active', 'dissolved')),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  user_a_seen_at   TIMESTAMPTZ,
  user_b_seen_at   TIMESTAMPTZ
);

ALTER TABLE partnerships ENABLE ROW LEVEL SECURITY;

-- Only one active partnership between any two users
CREATE UNIQUE INDEX idx_partnerships_active_pair
  ON partnerships (LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id))
  WHERE status = 'active';

-- Only one pending invite per inviter+email
CREATE UNIQUE INDEX idx_partnerships_pending_invite
  ON partnerships (user_a_id, invited_email)
  WHERE status = 'pending';

-- A user can be in at most one active partnership. These cover the same-column
-- cases; partnerships_guard() covers a user who is user_a in one row and
-- user_b in another.
CREATE UNIQUE INDEX idx_partnerships_one_active_user_a
  ON partnerships (user_a_id) WHERE status = 'active';
CREATE UNIQUE INDEX idx_partnerships_one_active_user_b
  ON partnerships (user_b_id) WHERE status = 'active';

CREATE INDEX idx_partnerships_user_a ON partnerships(user_a_id);
CREATE INDEX idx_partnerships_user_b ON partnerships(user_b_id) WHERE user_b_id IS NOT NULL;
CREATE INDEX idx_partnerships_invited_email ON partnerships(invited_email) WHERE status = 'pending';

-- RLS: members can SELECT their own partnerships.
-- Also allows invited users to see pending invites addressed to their email
-- (user_b_id is NULL until the invite is accepted, so we must also match by invited_email).
CREATE POLICY "Members can view their partnerships"
  ON partnerships FOR SELECT
  USING (
    auth.uid() = user_a_id
    OR auth.uid() = user_b_id
    OR (status = 'pending' AND invited_email = (current_setting('request.jwt.claims', true)::jsonb ->> 'email'))
  );

-- RLS: only the inviter can INSERT, and only a pending invite with no partner
-- yet. Activation happens through the accept UPDATE, checked by
-- partnerships_guard() below.
CREATE POLICY "Users can create partnership invites"
  ON partnerships FOR INSERT
  WITH CHECK (
    auth.uid() = user_a_id
    AND status = 'pending'
    AND user_b_id IS NULL
  );

-- RLS: either member can UPDATE (accept, dissolve).
-- Invited user must be able to accept before user_b_id is populated.
CREATE POLICY "Members can update their partnerships"
  ON partnerships FOR UPDATE
  USING (
    auth.uid() = user_a_id
    OR auth.uid() = user_b_id
    OR (status = 'pending' AND invited_email = (current_setting('request.jwt.claims', true)::jsonb ->> 'email'))
  )
  WITH CHECK (
    auth.uid() = user_a_id
    OR auth.uid() = user_b_id
    OR (status = 'pending' AND invited_email = (current_setting('request.jwt.claims', true)::jsonb ->> 'email'))
  );

-- RLS: either member can DELETE (decline invite).
-- Invited user must be able to decline before user_b_id is populated.
CREATE POLICY "Members can delete their partnerships"
  ON partnerships FOR DELETE
  USING (
    auth.uid() = user_a_id
    OR auth.uid() = user_b_id
    OR (status = 'pending' AND invited_email = (current_setting('request.jwt.claims', true)::jsonb ->> 'email'))
  );


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


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. split_expenses
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE split_expenses (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_id  UUID        NOT NULL REFERENCES partnerships(id) ON DELETE CASCADE,
  paid_by_user_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transaction_id  UUID        REFERENCES transactions(id) ON DELETE SET NULL,
  description     TEXT        NOT NULL,
  total_amount    BIGINT      NOT NULL CHECK (total_amount > 0),
  payer_share     BIGINT      NOT NULL CHECK (payer_share >= 0),
  partner_share   BIGINT      NOT NULL CHECK (partner_share >= 0),
  is_settlement   BOOLEAN     DEFAULT FALSE,
  expense_date    DATE        NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  CHECK (payer_share + partner_share = total_amount)
);

ALTER TABLE split_expenses ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_split_expenses_partnership
  ON split_expenses(partnership_id, expense_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_split_expenses_paid_by
  ON split_expenses(paid_by_user_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_split_expenses_transaction
  ON split_expenses(transaction_id) WHERE transaction_id IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_split_expenses_one_active_per_transaction
  ON split_expenses(transaction_id) WHERE transaction_id IS NOT NULL AND deleted_at IS NULL;

-- RLS: scoped via partnership membership. Writes also require the payer to be
-- a member of the partnership; inserts may only link the caller's own
-- transaction.
CREATE POLICY "Members can view split expenses"
  ON split_expenses FOR SELECT
  USING (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
    )
    AND deleted_at IS NULL
  );

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

CREATE POLICY "Members can delete split expenses"
  ON split_expenses FOR DELETE
  USING (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
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

-- Split soft-delete RPC: an UPDATE that sets deleted_at fails the SELECT
-- policy's live-row check on the new row, so soft deletes go through definer
-- access. Membership and live-row checks stay explicit because this bypasses RLS.
CREATE OR REPLACE FUNCTION public.soft_delete_split_expense(p_split_id uuid, p_partnership_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.split_expenses s
  SET deleted_at = now()
  FROM public.partnerships p
  WHERE s.id = p_split_id
    AND s.partnership_id = p_partnership_id
    AND s.deleted_at IS NULL
    AND p.id = s.partnership_id
    AND auth.uid() IN (p.user_a_id, p.user_b_id);
$$;
REVOKE EXECUTE ON FUNCTION public.soft_delete_split_expense(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_split_expense(uuid, uuid) TO authenticated;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_partner_email — security-definer RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- Allows the invitee (user_b) of an active partnership to look up the
-- inviter's (user_a) email from auth.users, which is not accessible via the
-- normal client API.
--
-- Security notes:
--   • SECURITY DEFINER lets the function read auth.users as the DB owner.
--   • The JOIN + AND p.user_b_id = auth.uid() scopes the result to exactly
--     the calling user's active partnership — it cannot be used to look up
--     arbitrary users' emails.
--   • REVOKE/GRANT restricts execution to authenticated users only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_partner_email(p_partnership_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT au.email
  FROM auth.users au
  JOIN partnerships p ON p.user_a_id = au.id
  WHERE p.id = p_partnership_id
    AND p.status = 'active'
    AND p.user_b_id = auth.uid();
$$;

REVOKE EXECUTE ON FUNCTION public.get_partner_email(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_partner_email(UUID) TO authenticated;
