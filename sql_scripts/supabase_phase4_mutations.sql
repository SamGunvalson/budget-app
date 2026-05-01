-- =============================================================================
-- Budget App — Phase 4: mutation batching + write-path cleanup
--
-- Replaces five client-side multi-round-trip mutation paths with single SQL
-- RPCs (or, in one case, a Postgres trigger):
--
--   • bulk_update_transactions(p_updates jsonb)
--       Was: N parallel UPDATEs in src/services/transactions.js#bulkUpdateTransactions
--       Now: single UPDATE … FROM jsonb_array_elements that returns the
--            joined rows the UI was already consuming (categories + accounts).
--
--   • bulk_update_category_sort_order(p_items jsonb)
--       Was: N parallel UPDATEs in src/services/categories.js#bulkUpdateSortOrder
--       Now: single UPDATE … FROM jsonb_array_elements.
--
--   • upsert_recurring_group(p_parent_id, p_parent jsonb, p_children jsonb)
--       Was: 1 + N inserts (create) or 1 + 2N updates + N deletes (update),
--            all serial, in src/services/recurring.js#createRecurringGroup /
--            updateRecurringGroup.
--       Now: a single SECURITY INVOKER plpgsql function.
--
--   • assert_account_open()  (BEFORE INSERT trigger on transactions)
--       Was: extra SELECT closed_at round-trip from
--            src/services/transactions.js#assertAccountOpen on every
--            createTransaction / createTransfer / createLinkedTransfer /
--            createAdjustment.
--       Now: trigger raises a check_violation with a friendly message; the
--            client just propagates error.message.
--
-- All functions are SECURITY INVOKER and pin search_path so existing RLS
-- continues to enforce row visibility — we never widen access.
--
-- Idempotent: safe to re-run.  Drops + recreates each function and uses
-- IF NOT EXISTS / DROP-then-create on triggers.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. assert_account_open — trigger on transactions
--    Rejects INSERTs whose account_id points at a closed account.  Saves the
--    extra "SELECT closed_at" round-trip the client used to issue before
--    every create.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION assert_account_open()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_closed_at date;
BEGIN
  -- account_id is NOT NULL on transactions, but be defensive.
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT closed_at INTO v_closed_at
  FROM accounts
  WHERE id = NEW.account_id;

  IF v_closed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot create transactions on a closed account.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_assert_account_open ON transactions;
CREATE TRIGGER trg_transactions_assert_account_open
  BEFORE INSERT ON transactions
  FOR EACH ROW EXECUTE FUNCTION assert_account_open();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. bulk_update_transactions(p_updates jsonb)
--    Single UPDATE for an array of {id, ...fields} objects.  Returns each
--    updated row enriched with the same `categories` and `accounts` joins
--    the existing service surface returns, so callers don't have to refetch.
--
--    Field semantics: a field is updated only when its key is present on
--    the input object.  Missing key = leave column alone.  Explicit JSON
--    null = set column to NULL (matches the existing per-row updater).
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS bulk_update_transactions(jsonb);

CREATE OR REPLACE FUNCTION bulk_update_transactions(p_updates jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result  jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH input AS (
    SELECT
      (i->>'id')::uuid AS id,
      i                AS raw
    FROM jsonb_array_elements(COALESCE(p_updates, '[]'::jsonb)) i
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
      status           = CASE WHEN i.raw ? 'status'           THEN i.raw->>'status'                   ELSE t.status           END,
      updated_at       = now()
    FROM input i
    WHERE t.id = i.id
      AND t.user_id = v_user_id
      AND t.deleted_at IS NULL
    RETURNING t.*
  )
  SELECT COALESCE(jsonb_agg(
    to_jsonb(u) || jsonb_build_object(
      'categories',
        (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'type', c.type)
         FROM categories c WHERE c.id = u.category_id),
      'accounts',
        (SELECT jsonb_build_object('id', a.id, 'name', a.name, 'type', a.type)
         FROM accounts   a WHERE a.id = u.account_id)
    )
  ), '[]'::jsonb)
  INTO v_result
  FROM updated u;

  RETURN v_result;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. bulk_update_category_sort_order(p_items jsonb)
--    Single UPDATE for an array of {id, sort_order} objects.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS bulk_update_category_sort_order(jsonb);

CREATE OR REPLACE FUNCTION bulk_update_category_sort_order(p_items jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE categories c
  SET sort_order = (i->>'sort_order')::int
  FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb)) i
  WHERE c.id = (i->>'id')::uuid
    AND c.user_id = v_user_id;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. upsert_recurring_group(p_parent_id, p_parent, p_children)
--    Create-or-update a recurring group (parent + children) in one round-trip.
--      • p_parent_id NULL  → create a new group (parent inserted).
--      • p_parent_id given → update that parent in place.
--    Children with an `id` matching an existing active child get updated;
--    others are inserted.  Existing active children NOT in the input list
--    are soft-deleted (is_active = false).
--
--    Children always inherit the parent's schedule fields (frequency,
--    day_of_*, custom_*, start_date, end_date) — same behavior as the old
--    JS path.
--
--    Returns the parent template id; caller refetches with
--    getRecurringTemplates() to get the joined+nested view.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS upsert_recurring_group(uuid, jsonb, jsonb);

CREATE OR REPLACE FUNCTION upsert_recurring_group(
  p_parent_id uuid,
  p_parent    jsonb,
  p_children  jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_parent_id    uuid;
  v_child        jsonb;
  v_idx          int  := 0;
  v_existing_ids uuid[];
  v_kept_ids     uuid[] := ARRAY[]::uuid[];
  v_child_id     uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── Parent: insert or update ───────────────────────────────────────────
  IF p_parent_id IS NULL THEN
    INSERT INTO recurring_templates (
      user_id, account_id, category_id, description, payee, amount, is_income,
      frequency, day_of_month, day_of_month_2, day_of_week,
      custom_interval, custom_unit, start_date, end_date,
      to_account_id, is_transfer,
      is_group_parent, group_order,
      is_split, split_method, split_payer, split_partner_share_pct,
      auto_confirm, is_paused
    )
    VALUES (
      v_user_id,
      (p_parent->>'account_id')::uuid,
      (p_parent->>'category_id')::uuid,
      COALESCE(p_parent->>'description', ''),
      NULLIF(p_parent->>'payee', ''),
      (p_parent->>'amount')::bigint,
      COALESCE((p_parent->>'is_income')::boolean, false),
      p_parent->>'frequency',
      NULLIF(p_parent->>'day_of_month','')::int,
      NULLIF(p_parent->>'day_of_month_2','')::int,
      NULLIF(p_parent->>'day_of_week','')::int,
      NULLIF(p_parent->>'custom_interval','')::int,
      NULLIF(p_parent->>'custom_unit',''),
      (p_parent->>'start_date')::date,
      NULLIF(p_parent->>'end_date','')::date,
      NULLIF(p_parent->>'to_account_id','')::uuid,
      COALESCE((p_parent->>'is_transfer')::boolean, false),
      true,
      0,
      COALESCE((p_parent->>'is_split')::boolean, false),
      NULLIF(p_parent->>'split_method',''),
      NULLIF(p_parent->>'split_payer',''),
      NULLIF(p_parent->>'split_partner_share_pct','')::int,
      COALESCE((p_parent->>'auto_confirm')::boolean, true),
      COALESCE((p_parent->>'is_paused')::boolean, false)
    )
    RETURNING id INTO v_parent_id;
  ELSE
    v_parent_id := p_parent_id;
    UPDATE recurring_templates SET
      account_id              = COALESCE(NULLIF(p_parent->>'account_id','')::uuid,    account_id),
      category_id             = COALESCE(NULLIF(p_parent->>'category_id','')::uuid,   category_id),
      description             = CASE WHEN p_parent ? 'description'   THEN COALESCE(p_parent->>'description','') ELSE description END,
      payee                   = CASE WHEN p_parent ? 'payee'         THEN NULLIF(p_parent->>'payee','')        ELSE payee END,
      amount                  = COALESCE(NULLIF(p_parent->>'amount','')::bigint,      amount),
      is_income               = COALESCE((p_parent->>'is_income')::boolean,           is_income),
      frequency               = COALESCE(NULLIF(p_parent->>'frequency',''),           frequency),
      day_of_month            = CASE WHEN p_parent ? 'day_of_month'    THEN NULLIF(p_parent->>'day_of_month','')::int    ELSE day_of_month    END,
      day_of_month_2          = CASE WHEN p_parent ? 'day_of_month_2'  THEN NULLIF(p_parent->>'day_of_month_2','')::int  ELSE day_of_month_2  END,
      day_of_week             = CASE WHEN p_parent ? 'day_of_week'     THEN NULLIF(p_parent->>'day_of_week','')::int     ELSE day_of_week     END,
      custom_interval         = CASE WHEN p_parent ? 'custom_interval' THEN NULLIF(p_parent->>'custom_interval','')::int ELSE custom_interval END,
      custom_unit             = CASE WHEN p_parent ? 'custom_unit'     THEN NULLIF(p_parent->>'custom_unit','')           ELSE custom_unit     END,
      start_date              = COALESCE(NULLIF(p_parent->>'start_date','')::date,    start_date),
      end_date                = CASE WHEN p_parent ? 'end_date'        THEN NULLIF(p_parent->>'end_date','')::date        ELSE end_date        END,
      to_account_id           = CASE WHEN p_parent ? 'to_account_id'   THEN NULLIF(p_parent->>'to_account_id','')::uuid   ELSE to_account_id   END,
      is_transfer             = COALESCE((p_parent->>'is_transfer')::boolean, is_transfer),
      is_group_parent         = true,
      auto_confirm            = COALESCE((p_parent->>'auto_confirm')::boolean, auto_confirm),
      is_paused               = COALESCE((p_parent->>'is_paused')::boolean, is_paused),
      is_split                = COALESCE((p_parent->>'is_split')::boolean, is_split),
      split_method            = CASE WHEN p_parent ? 'split_method' THEN NULLIF(p_parent->>'split_method','') ELSE split_method END,
      split_payer             = CASE WHEN p_parent ? 'split_payer'  THEN NULLIF(p_parent->>'split_payer','')  ELSE split_payer  END,
      split_partner_share_pct = CASE WHEN p_parent ? 'split_partner_share_pct'
                                     THEN NULLIF(p_parent->>'split_partner_share_pct','')::int
                                     ELSE split_partner_share_pct END
    WHERE id = v_parent_id AND user_id = v_user_id;
  END IF;

  -- ── Existing active child IDs (before we mutate) ───────────────────────
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  INTO v_existing_ids
  FROM recurring_templates
  WHERE group_id = v_parent_id
    AND user_id  = v_user_id
    AND is_active = true;

  -- ── Children: update existing or insert new, in input order ────────────
  FOR v_child IN
    SELECT * FROM jsonb_array_elements(COALESCE(p_children, '[]'::jsonb))
  LOOP
    v_child_id := NULLIF(v_child->>'id','')::uuid;

    IF v_child_id IS NOT NULL AND v_child_id = ANY(v_existing_ids) THEN
      UPDATE recurring_templates SET
        account_id              = COALESCE(NULLIF(v_child->>'account_id','')::uuid,  account_id),
        category_id             = COALESCE(NULLIF(v_child->>'category_id','')::uuid, category_id),
        description             = CASE WHEN v_child ? 'description' THEN COALESCE(v_child->>'description','') ELSE description END,
        payee                   = CASE WHEN v_child ? 'payee'       THEN NULLIF(v_child->>'payee','')         ELSE payee       END,
        amount                  = COALESCE(NULLIF(v_child->>'amount','')::bigint,    amount),
        is_income               = COALESCE((v_child->>'is_income')::boolean,         is_income),
        is_transfer             = COALESCE((v_child->>'is_transfer')::boolean,       is_transfer),
        to_account_id           = CASE WHEN v_child ? 'to_account_id' THEN NULLIF(v_child->>'to_account_id','')::uuid ELSE to_account_id END,
        is_split                = COALESCE((v_child->>'is_split')::boolean,          is_split),
        split_method            = CASE WHEN v_child ? 'split_method' THEN NULLIF(v_child->>'split_method','') ELSE split_method END,
        split_payer             = CASE WHEN v_child ? 'split_payer'  THEN NULLIF(v_child->>'split_payer','')  ELSE split_payer  END,
        split_partner_share_pct = CASE WHEN v_child ? 'split_partner_share_pct'
                                       THEN NULLIF(v_child->>'split_partner_share_pct','')::int
                                       ELSE split_partner_share_pct END,
        -- Children inherit the parent schedule (matches createRecurringGroup
        -- and updateRecurringGroup behavior).
        frequency       = COALESCE(NULLIF(p_parent->>'frequency',''),                frequency),
        day_of_month    = NULLIF(p_parent->>'day_of_month','')::int,
        day_of_month_2  = NULLIF(p_parent->>'day_of_month_2','')::int,
        day_of_week     = NULLIF(p_parent->>'day_of_week','')::int,
        custom_interval = NULLIF(p_parent->>'custom_interval','')::int,
        custom_unit     = NULLIF(p_parent->>'custom_unit',''),
        start_date      = COALESCE(NULLIF(p_parent->>'start_date','')::date,         start_date),
        end_date        = NULLIF(p_parent->>'end_date','')::date,
        group_id        = v_parent_id,
        group_order     = v_idx,
        is_group_parent = false,
        is_active       = true
      WHERE id = v_child_id AND user_id = v_user_id;

      v_kept_ids := array_append(v_kept_ids, v_child_id);
    ELSE
      INSERT INTO recurring_templates (
        user_id, account_id, category_id, description, payee, amount, is_income,
        frequency, day_of_month, day_of_month_2, day_of_week,
        custom_interval, custom_unit, start_date, end_date,
        to_account_id, is_transfer,
        group_id, group_order, is_group_parent,
        is_split, split_method, split_payer, split_partner_share_pct
      )
      VALUES (
        v_user_id,
        (v_child->>'account_id')::uuid,
        (v_child->>'category_id')::uuid,
        COALESCE(v_child->>'description', ''),
        NULLIF(v_child->>'payee', ''),
        (v_child->>'amount')::bigint,
        COALESCE((v_child->>'is_income')::boolean, false),
        -- inherit parent schedule
        p_parent->>'frequency',
        NULLIF(p_parent->>'day_of_month','')::int,
        NULLIF(p_parent->>'day_of_month_2','')::int,
        NULLIF(p_parent->>'day_of_week','')::int,
        NULLIF(p_parent->>'custom_interval','')::int,
        NULLIF(p_parent->>'custom_unit',''),
        (p_parent->>'start_date')::date,
        NULLIF(p_parent->>'end_date','')::date,
        NULLIF(v_child->>'to_account_id','')::uuid,
        COALESCE((v_child->>'is_transfer')::boolean, false),
        v_parent_id,
        v_idx,
        false,
        COALESCE((v_child->>'is_split')::boolean, false),
        NULLIF(v_child->>'split_method',''),
        NULLIF(v_child->>'split_payer',''),
        NULLIF(v_child->>'split_partner_share_pct','')::int
      );
    END IF;

    v_idx := v_idx + 1;
  END LOOP;

  -- ── Soft-delete children that existed before but weren't in the input ──
  IF p_parent_id IS NOT NULL THEN
    UPDATE recurring_templates
    SET is_active = false
    WHERE group_id = v_parent_id
      AND user_id  = v_user_id
      AND is_active = true
      AND NOT (id = ANY(v_kept_ids));
  END IF;

  RETURN v_parent_id;
END;
$$;
