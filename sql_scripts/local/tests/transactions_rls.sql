-- Run with psql -X -v ON_ERROR_STOP=1 as the owner of an initialized local DB.
-- Fixtures and mutations are rolled back; never run against a live Supabase DB.
BEGIN;

INSERT INTO auth.users (id, email, encrypted_password) VALUES
  ('10000000-0000-0000-0000-000000000001', 'rls-a@example.invalid', 'unused'),
  ('10000000-0000-0000-0000-000000000002', 'rls-b@example.invalid', 'unused');

INSERT INTO public.accounts (id, user_id, name, type)
SELECT id, id, 'RLS test account', 'checking'
FROM auth.users WHERE email IN ('rls-a@example.invalid', 'rls-b@example.invalid');

INSERT INTO public.categories (id, user_id, name, type)
SELECT id, id, 'RLS test category', 'needs'
FROM auth.users WHERE email IN ('rls-a@example.invalid', 'rls-b@example.invalid');

INSERT INTO public.transactions (
  id, user_id, account_id, category_id, amount, description,
  transaction_date, deleted_at, updated_at
)
SELECT
  ('20000000-0000-0000-0000-00000000000' || n)::uuid,
  owner_id, owner_id, owner_id, 100, 'RLS fixture', current_date,
  CASE WHEN n = 3 THEN '2020-01-01'::timestamptz END,
  '2020-01-01'::timestamptz
FROM generate_series(1, 4) AS n
CROSS JOIN LATERAL (
  SELECT CASE WHEN n = 4
    THEN '10000000-0000-0000-0000-000000000002'::uuid
    ELSE '10000000-0000-0000-0000-000000000001'::uuid END AS owner_id
) AS owners;

DO $$
BEGIN
  ASSERT (SELECT count(*) = 4 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transactions');
  ASSERT NOT EXISTS (SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'transactions'
      AND (cmd = 'ALL' OR roles <> ARRAY['authenticated']::name[]));
  ASSERT NOT has_function_privilege('anon', 'public.soft_delete_transaction(uuid)', 'EXECUTE');
  ASSERT has_function_privilege('authenticated', 'public.soft_delete_transaction(uuid)', 'EXECUTE');
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

DO $$
DECLARE
  affected integer;
BEGIN
  ASSERT (SELECT count(*) = 2 FROM public.transactions);

  UPDATE public.transactions SET description = 'Updated'
  WHERE id = '20000000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'Own live transactions must remain editable';

  UPDATE public.transactions SET description = 'Forbidden'
  WHERE id IN ('20000000-0000-0000-0000-000000000003',
               '20000000-0000-0000-0000-000000000004');
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 0, 'Deleted and other-user transactions must not be editable';

  BEGIN
    UPDATE public.transactions
    SET user_id = '10000000-0000-0000-0000-000000000002'
    WHERE id = '20000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Ownership reassignment should have failed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  INSERT INTO public.transactions (
    user_id, account_id, category_id, amount, description, transaction_date
  ) VALUES (
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001', 100, 'Own insert', current_date
  );

  BEGIN
    INSERT INTO public.transactions (
      user_id, account_id, category_id, amount, description, transaction_date
    ) VALUES (
      '10000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002',
      '10000000-0000-0000-0000-000000000002', 100, 'Forbidden insert', current_date
    );
    RAISE EXCEPTION 'Other-user insert should have failed';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  PERFORM public.soft_delete_transaction('20000000-0000-0000-0000-000000000001');
  PERFORM public.soft_delete_transaction('20000000-0000-0000-0000-000000000001');
  PERFORM public.soft_delete_transaction('20000000-0000-0000-0000-000000000003');
  PERFORM public.soft_delete_transaction('20000000-0000-0000-0000-000000000004');
  PERFORM public.soft_delete_transaction('20000000-0000-0000-0000-000000000099');
  ASSERT NOT EXISTS (SELECT 1 FROM public.transactions
    WHERE id = '20000000-0000-0000-0000-000000000001');

  DELETE FROM public.transactions WHERE description = 'Own insert';
  GET DIAGNOSTICS affected = ROW_COUNT;
  ASSERT affected = 1, 'Existing owner-only hard deletes must remain allowed';
END;
$$;

-- Even an authenticated role without a user identity cannot delete anything.
SELECT set_config('request.jwt.claims', '{}', true);
SELECT public.soft_delete_transaction('20000000-0000-0000-0000-000000000002');
RESET ROLE;

DO $$
BEGIN
  ASSERT (SELECT deleted_at IS NOT NULL AND updated_at > '2020-01-01'::timestamptz
    FROM public.transactions WHERE id = '20000000-0000-0000-0000-000000000001');
  ASSERT (SELECT deleted_at IS NULL FROM public.transactions
    WHERE id = '20000000-0000-0000-0000-000000000002');
  ASSERT (SELECT deleted_at = '2020-01-01'::timestamptz
    FROM public.transactions WHERE id = '20000000-0000-0000-0000-000000000003');
  ASSERT (SELECT deleted_at IS NULL FROM public.transactions
    WHERE id = '20000000-0000-0000-0000-000000000004');
END;
$$;

-- Recurring cleanup must retain the live-row policies and recheck status/date
-- in the write, including transactions posted after orphan discovery.
INSERT INTO public.recurring_templates (
  id, user_id, account_id, category_id, amount, description, frequency, start_date
)
SELECT id, id, id, id, 100, 'RLS recurring fixture', 'monthly', current_date
FROM auth.users WHERE email IN ('rls-a@example.invalid', 'rls-b@example.invalid');

INSERT INTO public.transactions (
  id, user_id, account_id, category_id, amount, description,
  transaction_date, status, recurring_template_id, deleted_at, updated_at
)
SELECT
  ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
  owner_id, owner_id, owner_id, 100, 'Recurring RLS fixture',
  CASE WHEN n = 4 THEN current_date - 1 ELSE current_date END,
  CASE WHEN n = 3 THEN 'posted' WHEN n = 2 THEN 'pending' ELSE 'projected' END,
  CASE WHEN n = 7 THEN NULL ELSE owner_id END,
  CASE WHEN n = 5 THEN '2020-01-01'::timestamptz END,
  '2020-01-01'::timestamptz
FROM generate_series(1, 8) AS n
CROSS JOIN LATERAL (
  SELECT CASE WHEN n = 6
    THEN '10000000-0000-0000-0000-000000000002'::uuid
    ELSE '10000000-0000-0000-0000-000000000001'::uuid END AS owner_id
) AS owners;

DO $$
BEGIN
  ASSERT NOT has_function_privilege('anon',
    'public.soft_delete_recurring_projections(uuid[],uuid[],date)', 'EXECUTE');
  ASSERT has_function_privilege('authenticated',
    'public.soft_delete_recurring_projections(uuid[],uuid[],date)', 'EXECUTE');
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

DO $$
BEGIN
  BEGIN
    UPDATE public.transactions SET deleted_at = now(), updated_at = now()
    WHERE recurring_template_id = '10000000-0000-0000-0000-000000000001'
      AND status IN ('projected', 'pending')
      AND deleted_at IS NULL AND transaction_date >= current_date;
    RAISE EXCEPTION 'Direct cleanup should fail the live-row SELECT policy';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    PERFORM public.soft_delete_recurring_projections(NULL, NULL, current_date);
    RAISE EXCEPTION 'Unscoped cleanup should have failed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.soft_delete_recurring_projections(ARRAY[]::uuid[], NULL, NULL);
    RAISE EXCEPTION 'Missing date should have failed';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  ASSERT public.soft_delete_recurring_projections(ARRAY[]::uuid[], NULL, current_date) = 0;
  ASSERT public.soft_delete_recurring_projections(
    ARRAY['10000000-0000-0000-0000-000000000002']::uuid[],
    ARRAY['30000000-0000-0000-0000-000000000001']::uuid[], current_date) = 0,
    'Template and transaction filters must intersect';
  ASSERT public.soft_delete_recurring_projections(
    ARRAY['10000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000002']::uuid[],
    NULL, current_date + 1) = 0, 'The cutoff must preserve today';

  ASSERT public.soft_delete_recurring_projections(
    NULL, ARRAY['30000000-0000-0000-0000-000000000003',
                '30000000-0000-0000-0000-000000000006',
                '30000000-0000-0000-0000-000000000008']::uuid[], current_date) = 1,
    'ID cleanup must preserve posted and other-user transactions';
  ASSERT public.soft_delete_recurring_projections(
    ARRAY['10000000-0000-0000-0000-000000000001',
          '10000000-0000-0000-0000-000000000002']::uuid[],
    NULL, current_date) = 2,
    'Family cleanup must only delete owned live projected/pending recurring rows';
  ASSERT public.soft_delete_recurring_projections(
    ARRAY['10000000-0000-0000-0000-000000000001']::uuid[],
    NULL, current_date) = 0, 'Repeated cleanup must be idempotent';
END;
$$;

SELECT set_config('request.jwt.claims', '{}', true);
DO $$
BEGIN
  BEGIN
    PERFORM public.soft_delete_recurring_projections(
      ARRAY['10000000-0000-0000-0000-000000000002']::uuid[], NULL, current_date);
    RAISE EXCEPTION 'Unauthenticated cleanup should have failed';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
RESET ROLE;

DO $$
BEGIN
  ASSERT (SELECT count(*) = 3 FROM public.transactions
    WHERE description = 'Recurring RLS fixture'
      AND deleted_at IS NOT NULL AND updated_at > '2020-01-01'::timestamptz);
  ASSERT (SELECT count(*) = 4 FROM public.transactions
    WHERE description = 'Recurring RLS fixture' AND deleted_at IS NULL);
  ASSERT (SELECT deleted_at = '2020-01-01'::timestamptz FROM public.transactions
    WHERE id = '30000000-0000-0000-0000-000000000005');
END;
$$;

ROLLBACK;
