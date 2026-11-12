-- Run with psql -X -v ON_ERROR_STOP=1 as the owner of an initialized local DB.
-- Fixtures and mutations are rolled back; never run against a live Supabase DB.
-- Covers partnership invite/accept/dissolve rules (partnerships_guard and the
-- INSERT policy) and split_expenses payer/transaction checks.
BEGIN;

INSERT INTO auth.users (id, email, encrypted_password) VALUES
  ('11000000-0000-0000-0000-000000000001', 'pt-a@example.invalid', 'unused'),
  ('11000000-0000-0000-0000-000000000002', 'pt-b@example.invalid', 'unused'),
  ('11000000-0000-0000-0000-000000000003', 'pt-c@example.invalid', 'unused');

INSERT INTO public.accounts (id, user_id, name, type)
SELECT id, id, 'Partnership test account', 'checking'
FROM auth.users WHERE email LIKE 'pt-_@example.invalid';

INSERT INTO public.categories (id, user_id, name, type)
SELECT id, id, 'Partnership test category', 'needs'
FROM auth.users WHERE email LIKE 'pt-_@example.invalid';

-- One transaction each for A (…01) and C (…03).
INSERT INTO public.transactions (
  id, user_id, account_id, category_id, amount, description, transaction_date
)
SELECT ('21000000-0000-0000-0000-00000000000' || right(id::text, 1))::uuid,
  id, id, id, 100, 'Partnership fixture', current_date
FROM auth.users WHERE email IN ('pt-a@example.invalid', 'pt-c@example.invalid');

SET LOCAL ROLE authenticated;

-- ── User A: invites ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated","email":"pt-a@example.invalid"}', true);

DO $$
BEGIN
  BEGIN
    INSERT INTO public.partnerships (user_a_id, user_b_id, invited_email, status)
    VALUES ('11000000-0000-0000-0000-000000000001',
            '11000000-0000-0000-0000-000000000003', 'pt-c@example.invalid', 'active');
    RAISE EXCEPTION 'Inserting an active partnership should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.partnerships (user_a_id, user_b_id, invited_email)
    VALUES ('11000000-0000-0000-0000-000000000001',
            '11000000-0000-0000-0000-000000000003', 'pt-c@example.invalid');
    RAISE EXCEPTION 'Inserting a pending invite with user_b_id should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  INSERT INTO public.partnerships (id, user_a_id, invited_email) VALUES
    ('31000000-0000-0000-0000-000000000001',
     '11000000-0000-0000-0000-000000000001', 'pt-b@example.invalid'),
    ('31000000-0000-0000-0000-000000000002',
     '11000000-0000-0000-0000-000000000001', 'pt-c@example.invalid');

  -- The inviter cannot activate their own invite.
  BEGIN
    UPDATE public.partnerships
    SET status = 'active', user_b_id = '11000000-0000-0000-0000-000000000002'
    WHERE id = '31000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Inviter activating an invite should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

-- ── User C: cannot accept B's invite; can see only their own ────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000003","role":"authenticated","email":"pt-c@example.invalid"}', true);

DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.partnerships
  SET status = 'active', user_b_id = '11000000-0000-0000-0000-000000000003'
  WHERE id = '31000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'An invite addressed to someone else must not be visible';

  BEGIN
    UPDATE public.partnerships SET user_a_seen_at = now()
    WHERE id = '31000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'A pending invitee writing to the invite should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

-- ── User B: accepts ─────────────────────────────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated","email":"pt-b@example.invalid"}', true);

DO $$
DECLARE
  affected integer;
BEGIN
  -- Accepting on behalf of someone else is rejected.
  BEGIN
    UPDATE public.partnerships
    SET status = 'active', user_b_id = '11000000-0000-0000-0000-000000000003'
    WHERE id = '31000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Accepting with another user id should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Skipping straight to dissolved is rejected.
  BEGIN
    UPDATE public.partnerships SET status = 'dissolved'
    WHERE id = '31000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'pending to dissolved should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  UPDATE public.partnerships
  SET status = 'active', user_b_id = '11000000-0000-0000-0000-000000000002',
      updated_at = now()
  WHERE id = '31000000-0000-0000-0000-000000000001' AND status = 'pending';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'The invited user must be able to accept';

  -- Notification watermark updates remain allowed.
  UPDATE public.partnerships SET user_b_seen_at = now()
  WHERE id = '31000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'Members must be able to update seen timestamps';

  -- Identity columns are frozen.
  BEGIN
    UPDATE public.partnerships SET invited_email = 'pt-c@example.invalid'
    WHERE id = '31000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Rewriting invited_email should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.partnerships SET user_a_id = '11000000-0000-0000-0000-000000000003'
    WHERE id = '31000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Rewriting user_a_id should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.partnerships SET user_b_id = '11000000-0000-0000-0000-000000000003'
    WHERE id = '31000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Rewriting user_b_id should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Split expenses: payer must be a member; linked transaction must be the caller's.
  INSERT INTO public.split_expenses (
    id, partnership_id, paid_by_user_id, description, total_amount, payer_share, partner_share
  ) VALUES (
    '41000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001', 'Partner paid', 100, 50, 50
  );
  BEGIN
    INSERT INTO public.split_expenses (
      partnership_id, paid_by_user_id, description, total_amount, payer_share, partner_share
    ) VALUES (
      '31000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000003', 'Outsider paid', 100, 50, 50
    );
    RAISE EXCEPTION 'A non-member payer should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.split_expenses (
      partnership_id, paid_by_user_id, transaction_id, description,
      total_amount, payer_share, partner_share
    ) VALUES (
      '31000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000002',
      '21000000-0000-0000-0000-000000000003', 'Foreign transaction', 100, 50, 50
    );
    RAISE EXCEPTION 'Linking another user''s transaction should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.split_expenses
    SET paid_by_user_id = '11000000-0000-0000-0000-000000000003'
    WHERE id = '41000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Reassigning the payer to a non-member should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- Links are frozen: no re-pointing at a transaction or another partnership.
  BEGIN
    UPDATE public.split_expenses
    SET transaction_id = '21000000-0000-0000-0000-000000000003'
    WHERE id = '41000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Re-pointing transaction_id should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.split_expenses
    SET partnership_id = '31000000-0000-0000-0000-000000000002'
    WHERE id = '41000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Moving a split to another partnership should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE public.split_expenses SET description = 'Edited'
  WHERE id = '41000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'A member must be able to edit a split';
END;
$$;

-- ── User A: own transaction link works; second active partnership blocked ──
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated","email":"pt-a@example.invalid"}', true);

DO $$
BEGIN
  INSERT INTO public.split_expenses (
    partnership_id, paid_by_user_id, transaction_id, description,
    total_amount, payer_share, partner_share
  ) VALUES (
    '31000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    '21000000-0000-0000-0000-000000000001', 'Own transaction', 100, 50, 50
  );
END;
$$;

-- User B can edit and soft-delete the split A linked to A's own transaction.
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated","email":"pt-b@example.invalid"}', true);

DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.split_expenses SET description = 'Edited by partner'
  WHERE description = 'Own transaction';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'Partner must be able to edit a split linked to the other member''s transaction';

  -- A direct UPDATE of deleted_at fails the SELECT policy on the new row,
  -- so the app soft-deletes through the definer RPC.
  BEGIN
    UPDATE public.split_expenses SET deleted_at = now()
    WHERE description = 'Edited by partner';
    RAISE EXCEPTION 'Direct soft-delete UPDATE was expected to fail RLS';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  -- Wrong partnership ID: no change.
  PERFORM public.soft_delete_split_expense(
    (SELECT id FROM public.split_expenses WHERE description = 'Edited by partner'),
    '31000000-0000-0000-0000-000000000099');
  ASSERT EXISTS (SELECT 1 FROM public.split_expenses WHERE description = 'Edited by partner'),
    'Soft-delete RPC must require the matching partnership ID';

  PERFORM public.soft_delete_split_expense(
    (SELECT id FROM public.split_expenses WHERE description = 'Edited by partner'),
    '31000000-0000-0000-0000-000000000001');
  ASSERT NOT EXISTS (SELECT 1 FROM public.split_expenses WHERE description = 'Edited by partner'),
    'Partner must be able to soft-delete a shared split';
END;
$$;

-- User C accepts A's second invite: A is already in an active partnership.
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000003","role":"authenticated","email":"pt-c@example.invalid"}', true);

DO $$
BEGIN
  BEGIN
    UPDATE public.partnerships
    SET status = 'active', user_b_id = '11000000-0000-0000-0000-000000000003'
    WHERE id = '31000000-0000-0000-0000-000000000002' AND status = 'pending';
    RAISE EXCEPTION 'A second active partnership for user A should have failed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
END;
$$;

-- ── User A: dissolve, then no reactivation ─────────────────────────────────
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated","email":"pt-a@example.invalid"}', true);

DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.partnerships SET status = 'dissolved', updated_at = now()
  WHERE id = '31000000-0000-0000-0000-000000000001' AND status = 'active';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'A member must be able to dissolve';

  BEGIN
    UPDATE public.partnerships SET status = 'active'
    WHERE id = '31000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Reactivating a dissolved partnership should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO public.split_expenses (
      partnership_id, paid_by_user_id, description, total_amount, payer_share, partner_share
    ) VALUES (
      '31000000-0000-0000-0000-000000000001',
      '11000000-0000-0000-0000-000000000001', 'After dissolve', 100, 50, 50
    );
    RAISE EXCEPTION 'Inserting into a dissolved partnership should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;

-- With A free again, C can now accept the second invite.
SELECT set_config('request.jwt.claims',
  '{"sub":"11000000-0000-0000-0000-000000000003","role":"authenticated","email":"pt-c@example.invalid"}', true);

DO $$
DECLARE
  affected integer;
BEGIN
  UPDATE public.partnerships
  SET status = 'active', user_b_id = '11000000-0000-0000-0000-000000000003'
  WHERE id = '31000000-0000-0000-0000-000000000002' AND status = 'pending';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'Accept must succeed once the inviter has no active partnership';
END;
$$;

RESET ROLE;
ROLLBACK;
