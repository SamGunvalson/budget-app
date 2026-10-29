-- Apply after the base schema and supabase_add_updated_at.sql.
BEGIN;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

-- Serialize archive/reference changes per owner, including direct table writes.
CREATE OR REPLACE FUNCTION public.guard_category_archiving()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  owner_id uuid := NEW.user_id;
  blockers text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text, 17493));

  SELECT string_agg(DISTINCT b.label, '; ' ORDER BY b.label) INTO blockers
  FROM (
    SELECT 'Recurring: ' || t.description || ' (' || c.name || ')' AS label
    FROM categories c
    JOIN recurring_templates t ON t.user_id = c.user_id AND (
      t.category_id = c.id OR (
        c.type = 'transfer' AND lower(c.name) = 'account transfer'
        AND t.to_account_id IS NOT NULL AND NOT COALESCE(t.is_transfer, false)
      )
    )
    LEFT JOIN recurring_templates parent
      ON parent.id = t.group_id AND parent.user_id = t.user_id
    WHERE c.user_id = owner_id AND c.is_active = true AND c.is_archived
      AND t.is_active = true AND NOT COALESCE(t.is_paused, false)
      AND (t.group_id IS NULL OR
        (parent.is_active = true AND NOT COALESCE(parent.is_paused, false)))
    UNION ALL
    SELECT 'Quick template: ' ||
      COALESCE(NULLIF(template->>'label', ''), template->>'description', 'Unnamed') ||
      ' (' || c.name || ')'
    FROM user_preferences p
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(p.preference_value) = 'array'
        THEN p.preference_value ELSE '[]'::jsonb END
    ) AS template
    JOIN categories c ON c.id::text = lower(template->>'category_id')
      AND c.user_id = p.user_id
    WHERE p.user_id = owner_id AND p.preference_key = 'quick_transaction_templates'
      AND c.is_active = true AND c.is_archived
  ) b;

  IF blockers IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot use an archived category. Change or pause recurring schedules, and change or remove quick templates first. %', blockers
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_category_archive ON public.categories;
CREATE TRIGGER guard_category_archive
  AFTER INSERT OR UPDATE ON public.categories
  FOR EACH ROW EXECUTE FUNCTION public.guard_category_archiving();

DROP TRIGGER IF EXISTS guard_recurring_category_archive ON public.recurring_templates;
CREATE TRIGGER guard_recurring_category_archive
  AFTER INSERT OR UPDATE ON public.recurring_templates
  FOR EACH ROW EXECUTE FUNCTION public.guard_category_archiving();

DROP TRIGGER IF EXISTS guard_quick_category_archive ON public.user_preferences;
CREATE TRIGGER guard_quick_category_archive
  AFTER INSERT OR UPDATE ON public.user_preferences
  FOR EACH ROW
  WHEN (NEW.preference_key = 'quick_transaction_templates')
  EXECUTE FUNCTION public.guard_category_archiving();

CREATE OR REPLACE FUNCTION public.guard_transaction_category_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.category_id IS NOT DISTINCT FROM OLD.category_id THEN
      RETURN NEW;
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 17493));
  IF EXISTS (
    SELECT 1 FROM categories
    WHERE id = NEW.category_id AND user_id = NEW.user_id AND is_archived
  ) THEN
    RAISE EXCEPTION 'Restore the archived category or choose another before creating or recategorizing a transaction.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_transaction_category_archive ON public.transactions;
CREATE TRIGGER guard_transaction_category_archive
  BEFORE INSERT OR UPDATE OF category_id ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.guard_transaction_category_archive();

CREATE OR REPLACE FUNCTION public.set_category_archived(
  p_category_id uuid, p_archived boolean
)
RETURNS public.categories
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result public.categories;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_archived IS NULL THEN
    RAISE EXCEPTION 'Archive status is required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 17493));
  UPDATE public.categories SET is_archived = p_archived
  WHERE id = p_category_id AND user_id = auth.uid() AND is_active = true
  RETURNING * INTO result;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found or deleted' USING ERRCODE = 'no_data_found';
  END IF;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.set_category_archived(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_category_archived(uuid, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
