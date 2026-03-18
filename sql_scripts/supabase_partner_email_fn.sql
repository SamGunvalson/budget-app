-- Migration: add get_partner_email RPC
-- Allows the invitee (user_b) of an active partnership to look up the inviter's (user_a) email.
-- SECURITY DEFINER is required to read auth.users, which is not accessible via the public API.
-- The join on partnerships ensures only user_b of the specific active partnership can retrieve
-- user_a's email — it cannot be used to look up arbitrary user emails.

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

-- Revoke public execute and grant only to authenticated users
REVOKE EXECUTE ON FUNCTION public.get_partner_email(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_partner_email(UUID) TO authenticated;
