-- Run in the Supabase SQL Editor as the database owner.
-- Apply the RPC and policies atomically so soft deletes remain available.
BEGIN;

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Permissive policies are ORed: this legacy FOR ALL policy bypasses live-row checks.
DROP POLICY IF EXISTS "Users can manage their own transactions" ON public.transactions;

DROP POLICY IF EXISTS "Users can view their own active transactions" ON public.transactions;
CREATE POLICY "Users can view their own active transactions"
  ON public.transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Users can insert their own transactions" ON public.transactions;
CREATE POLICY "Users can insert their own transactions"
  ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own transactions" ON public.transactions;
CREATE POLICY "Users can update their own transactions"
  ON public.transactions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND deleted_at IS NULL)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own transactions" ON public.transactions;
CREATE POLICY "Users can delete their own transactions"
  ON public.transactions FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Definer access avoids SELECT RLS rejecting the soft-deleted result.
-- Ownership and live-row checks must remain explicit because this bypasses RLS.
CREATE OR REPLACE FUNCTION public.soft_delete_transaction(txn_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.transactions
  SET deleted_at = now(), updated_at = now()
  WHERE id = txn_id AND user_id = auth.uid() AND deleted_at IS NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.soft_delete_transaction(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_transaction(uuid) TO authenticated;

COMMIT;

-- Expect four authenticated policies (SELECT, INSERT, UPDATE, DELETE), no ALL.
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'transactions'
ORDER BY cmd, policyname;
