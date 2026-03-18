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
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_a_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b_id     UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_email TEXT        NOT NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'active', 'dissolved')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
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

-- RLS: only inviter can INSERT
CREATE POLICY "Users can create partnership invites"
  ON partnerships FOR INSERT
  WITH CHECK (auth.uid() = user_a_id);

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

-- RLS: scoped via active partnership membership
CREATE POLICY "Members can view split expenses"
  ON split_expenses FOR SELECT
  USING (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
        AND status = 'active'
    )
    AND deleted_at IS NULL
  );

CREATE POLICY "Members can insert split expenses"
  ON split_expenses FOR INSERT
  WITH CHECK (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
        AND status = 'active'
    )
  );

CREATE POLICY "Members can update split expenses"
  ON split_expenses FOR UPDATE
  USING (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
        AND status = 'active'
    )
    AND deleted_at IS NULL
  )
  WITH CHECK (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
        AND status = 'active'
    )
  );

CREATE POLICY "Members can delete split expenses"
  ON split_expenses FOR DELETE
  USING (
    partnership_id IN (
      SELECT id FROM partnerships
      WHERE (user_a_id = auth.uid() OR user_b_id = auth.uid())
        AND status = 'active'
    )
  );


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
