-- Run as the database owner before deploying the updated frontend.
BEGIN;

-- Soft-deleted results cannot pass transaction SELECT RLS, even without
-- returning rows. Restrict definer access to owned, live recurring projections.
CREATE OR REPLACE FUNCTION public.soft_delete_recurring_projections(
  p_template_ids uuid[],
  p_transaction_ids uuid[],
  p_from_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_from_date IS NULL OR (p_template_ids IS NULL AND p_transaction_ids IS NULL) THEN
    RAISE EXCEPTION 'Projection cleanup requires a date and template or transaction IDs'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.transactions
  SET deleted_at = now(), updated_at = now()
  WHERE user_id = v_user_id
    AND deleted_at IS NULL
    AND recurring_template_id IS NOT NULL
    AND status IN ('projected', 'pending')
    AND transaction_date >= p_from_date
    AND (p_template_ids IS NULL OR recurring_template_id = ANY(p_template_ids))
    AND (p_transaction_ids IS NULL OR id = ANY(p_transaction_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.soft_delete_recurring_projections(uuid[], uuid[], date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.soft_delete_recurring_projections(uuid[], uuid[], date) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
