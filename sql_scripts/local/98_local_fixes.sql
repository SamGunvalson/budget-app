-- The legacy RLS audit adds this permissive policy alongside the correct
-- per-operation policies from schema_create, exposing soft-deleted rows.
DROP POLICY IF EXISTS "Users can manage their own transactions" ON public.transactions;

-- Referenced by the client but missing from the checked-in Supabase migrations.
-- SECURITY DEFINER avoids the SELECT policy rejecting the soft-deleted result;
-- explicit ownership and live-row predicates preserve the caller's scope.
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
