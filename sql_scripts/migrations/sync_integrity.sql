-- Run with psql as the database owner, then deploy the updated frontend.
-- Sync integrity and atomic transfer edits for existing databases:
--   * server-stamped `updated_at` on insert/update for all seven synced tables
--     (client clocks no longer decide what incremental sync can see);
--   * an (user_id, updated_at, id) index for incremental transaction pulls;
--   * update_transfer_legs — both transfer legs in one locked statement;
--   * get_deleted_transaction_ids — owner-scoped deletion feed for sync.
-- Fresh installs get the same objects from add_updated_at.sql and
-- phase4_mutations.sql. Safe to re-run.
BEGIN;

-- Normally added by add_updated_at.sql; repeated so the triggers below never
-- target a table without the column.
ALTER TABLE categories          ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE budget_items        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE recurring_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_updated_at ON transactions;
CREATE TRIGGER trg_transactions_updated_at
  BEFORE INSERT OR UPDATE ON transactions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_categories_updated_at ON categories;
CREATE TRIGGER trg_categories_updated_at
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_accounts_updated_at ON accounts;
CREATE TRIGGER trg_accounts_updated_at
  BEFORE INSERT OR UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_budget_plans_updated_at ON budget_plans;
CREATE TRIGGER trg_budget_plans_updated_at
  BEFORE INSERT OR UPDATE ON budget_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_budget_items_updated_at ON budget_items;
CREATE TRIGGER trg_budget_items_updated_at
  BEFORE INSERT OR UPDATE ON budget_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_user_preferences_updated_at ON user_preferences;
CREATE TRIGGER trg_user_preferences_updated_at
  BEFORE INSERT OR UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_recurring_templates_updated_at ON recurring_templates;
CREATE TRIGGER trg_recurring_templates_updated_at
  BEFORE INSERT OR UPDATE ON recurring_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Incremental transaction pulls filter by owner and order by (updated_at, id).
CREATE INDEX IF NOT EXISTS idx_transactions_user_updated
  ON transactions(user_id, updated_at, id);

-- update_transfer_legs(p_updates jsonb)
-- Both legs of a transfer in one statement, so an edit can never leave one leg
-- changed and the other not. p_updates is a two-element array of
-- {id, ...fields}; a field is updated only when its key is present
-- (account_id, category_id, amount, description, payee, transaction_date,
-- is_income; amount_locked can only be set to true). The two ids must be
-- the caller's two live legs of one transfer group, which are locked first so
-- concurrent edits of the pair serialize. Returns the updated rows, joined as
-- bulk_update_transactions joins them, in input order.
CREATE OR REPLACE FUNCTION public.update_transfer_legs(p_updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_ids     uuid[];
  v_group   uuid;
  v_live    integer;
  v_matched integer;
  v_result  jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_updates) IS DISTINCT FROM 'array' OR jsonb_array_length(p_updates) <> 2 THEN
    RAISE EXCEPTION 'A transfer update needs exactly two legs'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  SELECT array_agg((i->>'id')::uuid) INTO v_ids FROM jsonb_array_elements(p_updates) i;
  IF v_ids[1] IS NULL OR v_ids[2] IS NULL OR v_ids[1] = v_ids[2] THEN
    RAISE EXCEPTION 'A transfer update needs two distinct leg ids'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT transfer_group_id INTO v_group
  FROM transactions
  WHERE id = v_ids[1] AND user_id = v_user_id AND deleted_at IS NULL;
  IF v_group IS NULL THEN
    RAISE EXCEPTION 'Transaction is not part of a transfer.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Lock every live leg of the group (in id order, avoiding deadlocks), then
  -- require that the group is exactly the two legs being updated.
  PERFORM 1 FROM transactions
  WHERE transfer_group_id = v_group AND user_id = v_user_id AND deleted_at IS NULL
  ORDER BY id
  FOR UPDATE;
  SELECT count(*), count(*) FILTER (WHERE id = ANY(v_ids))
  INTO v_live, v_matched
  FROM transactions
  WHERE transfer_group_id = v_group AND user_id = v_user_id AND deleted_at IS NULL;
  IF v_live <> 2 OR v_matched <> 2 THEN
    RAISE EXCEPTION 'Transfer legs are malformed.' USING ERRCODE = 'check_violation';
  END IF;

  WITH input AS (
    SELECT (i->>'id')::uuid AS id, i AS raw, ord
    FROM jsonb_array_elements(p_updates) WITH ORDINALITY AS e(i, ord)
  ),
  updated AS (
    UPDATE transactions t SET
      account_id       = CASE WHEN i.raw ? 'account_id'       THEN (i.raw->>'account_id')::uuid       ELSE t.account_id       END,
      category_id      = CASE WHEN i.raw ? 'category_id'      THEN (i.raw->>'category_id')::uuid      ELSE t.category_id      END,
      amount           = CASE WHEN i.raw ? 'amount'           THEN (i.raw->>'amount')::bigint         ELSE t.amount           END,
      description      = CASE WHEN i.raw ? 'description'      THEN COALESCE(i.raw->>'description','') ELSE t.description      END,
      payee            = CASE WHEN i.raw ? 'payee'            THEN NULLIF(i.raw->>'payee','')         ELSE t.payee            END,
      transaction_date = CASE WHEN i.raw ? 'transaction_date' THEN (i.raw->>'transaction_date')::date ELSE t.transaction_date END,
      is_income        = CASE WHEN i.raw ? 'is_income'        THEN (i.raw->>'is_income')::boolean     ELSE t.is_income        END,
      amount_locked    = t.amount_locked OR COALESCE((i.raw->>'amount_locked')::boolean, false),
      updated_at       = now()
    FROM input i
    WHERE t.id = i.id
      AND t.user_id = v_user_id
      AND t.deleted_at IS NULL
    RETURNING t.*, i.ord
  )
  SELECT jsonb_agg(
    (to_jsonb(u) - 'ord') || jsonb_build_object(
      'categories',
        (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'type', c.type)
         FROM categories c WHERE c.id = u.category_id),
      'accounts',
        (SELECT jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type)
         FROM accounts   a WHERE a.id = u.account_id)
    ) ORDER BY u.ord
  )
  INTO v_result
  FROM updated u;

  RETURN v_result;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.update_transfer_legs(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_transfer_legs(jsonb) TO authenticated;

-- get_deleted_transaction_ids(p_since timestamptz)
-- Incremental sync must learn about transactions soft-deleted on another
-- device, but SELECT RLS hides deleted rows. This definer RPC returns only the
-- ids (no contents) of the caller's own rows deleted after p_since, as a JSON
-- array. A NULL p_since returns nothing.
CREATE OR REPLACE FUNCTION public.get_deleted_transaction_ids(p_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(id ORDER BY updated_at, id), '[]'::jsonb)
  FROM public.transactions
  WHERE user_id = auth.uid()
    AND deleted_at IS NOT NULL
    AND updated_at > p_since;
$$;
REVOKE EXECUTE ON FUNCTION public.get_deleted_transaction_ids(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_deleted_transaction_ids(timestamptz) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';
