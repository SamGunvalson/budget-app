-- Upgrade for existing databases: install the split soft-delete RPC.
-- Fresh setup gets the same function from supabase_split_expenses.sql.
-- Safe to rerun (CREATE OR REPLACE + idempotent grants).
BEGIN;

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

COMMIT;
