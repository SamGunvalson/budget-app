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

ROLLBACK;
