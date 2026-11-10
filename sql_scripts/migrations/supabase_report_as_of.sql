-- Adds the optional `p_as_of DATE DEFAULT NULL` parameter to the report RPCs
-- so reports can exclude projected, pending, and future-dated transactions.
-- NULL keeps the previous behaviour (every live row counts).
-- Run as the database owner before deploying the updated frontend.
BEGIN;

DROP FUNCTION IF EXISTS get_plan_vs_actual(integer, integer);

CREATE OR REPLACE FUNCTION get_plan_vs_actual(
  p_month integer,
  p_year  integer,
  p_as_of date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_plan_id       uuid;
  v_planned_inc   bigint := 0;
  v_actual_inc    bigint := 0;
  v_start         date := make_date(p_year, p_month, 1);
  v_end           date := (make_date(p_year, p_month, 1) + INTERVAL '1 month')::date;
  v_categories    jsonb;
BEGIN
  SELECT id, total_income INTO v_plan_id, v_planned_inc
  FROM budget_plans
  WHERE user_id = v_uid AND month = p_month AND year = p_year;

  WITH planned AS (
    SELECT
      bi.category_id,
      c.name      AS category_name,
      c.color     AS category_color,
      c.type      AS category_type,
      c.sort_order,
      SUM(bi.planned_amount)::bigint AS planned
    FROM budget_items bi
    JOIN categories c ON c.id = bi.category_id
    WHERE bi.budget_plan_id = v_plan_id
      AND c.type <> 'transfer'
    GROUP BY bi.category_id, c.name, c.color, c.type, c.sort_order
  ),
  actual AS (
    SELECT
      COALESCE(t.category_id, '00000000-0000-0000-0000-000000000000'::uuid) AS category_id,
      COALESCE(c.name,       'Uncategorized')  AS category_name,
      COALESCE(c.color,      '#A8A29E')        AS category_color,
      COALESCE(c.type,       'expense')        AS category_type,
      COALESCE(c.sort_order, 999)              AS sort_order,
      SUM(
        CASE
          -- True income: credit in income cat → +actual
          WHEN t.is_income AND c.type = 'income' THEN  ABS(t.amount)
          -- Income debit: debit in income cat → -actual
          WHEN NOT t.is_income AND c.type = 'income' THEN -ABS(t.amount)
          -- Spending credit: credit in spending cat → -actual
          WHEN t.is_income AND c.type NOT IN ('income','transfer') THEN -ABS(t.amount)
          -- Default expense: debit in spending cat → +actual
          ELSE ABS(t.amount)
        END
      )::bigint AS actual
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = v_uid
      AND t.deleted_at IS NULL
      AND t.transaction_date >= v_start
      AND t.transaction_date <  v_end
      AND COALESCE(c.type, 'expense') <> 'transfer'
      -- p_as_of set: only posted rows dated on/before it (excludes projected,
      -- pending, and future-dated rows). NULL keeps every live row.
      AND (p_as_of IS NULL OR (t.status = 'posted' AND t.transaction_date <= p_as_of))
    GROUP BY t.category_id, c.name, c.color, c.type, c.sort_order
  ),
  merged AS (
    SELECT
      COALESCE(p.category_id, a.category_id) AS category_id,
      COALESCE(p.category_name, a.category_name) AS category_name,
      COALESCE(p.category_color, a.category_color) AS category_color,
      COALESCE(p.category_type, a.category_type) AS category_type,
      COALESCE(p.sort_order, a.sort_order, 999)  AS sort_order,
      COALESCE(p.planned, 0)::bigint AS planned,
      COALESCE(a.actual,  0)::bigint AS actual
    FROM planned p
    FULL OUTER JOIN actual a ON a.category_id = p.category_id
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'categoryId',    category_id,
        'categoryName',  category_name,
        'categoryColor', category_color,
        'categoryType',  category_type,
        'sortOrder',     sort_order,
        'planned',       planned,
        'actual',        actual
      )
      ORDER BY
        CASE category_type
          WHEN 'income'  THEN 0
          WHEN 'needs'   THEN 1
          WHEN 'wants'   THEN 2
          WHEN 'savings' THEN 3
          ELSE 4
        END,
        sort_order,
        category_name
    ),
    COALESCE(SUM(actual) FILTER (WHERE category_type = 'income'), 0)::bigint
  INTO v_categories, v_actual_inc
  FROM merged;

  RETURN jsonb_build_object(
    'categories',    COALESCE(v_categories, '[]'::jsonb),
    'plannedIncome', COALESCE(v_planned_inc, 0),
    'actualIncome',  COALESCE(v_actual_inc,  0)
  );
END;
$$;

DROP FUNCTION IF EXISTS get_plan_vs_actual_ytd(integer, integer);

CREATE OR REPLACE FUNCTION get_plan_vs_actual_ytd(
  p_year          integer,
  p_through_month integer,
  p_as_of         date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_planned_inc   bigint := 0;
  v_actual_inc    bigint := 0;
  v_start         date := make_date(p_year, 1, 1);
  v_end           date := (make_date(p_year, p_through_month, 1) + INTERVAL '1 month')::date;
  v_categories    jsonb;
BEGIN
  SELECT COALESCE(SUM(total_income), 0) INTO v_planned_inc
  FROM budget_plans
  WHERE user_id = v_uid
    AND year = p_year
    AND month BETWEEN 1 AND p_through_month;

  WITH plan_ids AS (
    SELECT id FROM budget_plans
    WHERE user_id = v_uid
      AND year = p_year
      AND month BETWEEN 1 AND p_through_month
  ),
  planned AS (
    SELECT
      bi.category_id,
      c.name      AS category_name,
      c.color     AS category_color,
      c.type      AS category_type,
      c.sort_order,
      SUM(bi.planned_amount)::bigint AS planned
    FROM budget_items bi
    JOIN plan_ids pi  ON pi.id = bi.budget_plan_id
    JOIN categories c ON c.id  = bi.category_id
    WHERE c.type <> 'transfer'
    GROUP BY bi.category_id, c.name, c.color, c.type, c.sort_order
  ),
  actual AS (
    SELECT
      COALESCE(t.category_id, '00000000-0000-0000-0000-000000000000'::uuid) AS category_id,
      COALESCE(c.name,       'Uncategorized')  AS category_name,
      COALESCE(c.color,      '#A8A29E')        AS category_color,
      COALESCE(c.type,       'expense')        AS category_type,
      COALESCE(c.sort_order, 999)              AS sort_order,
      SUM(
        CASE
          WHEN t.is_income AND c.type = 'income' THEN  ABS(t.amount)
          WHEN NOT t.is_income AND c.type = 'income' THEN -ABS(t.amount)
          WHEN t.is_income AND c.type NOT IN ('income','transfer') THEN -ABS(t.amount)
          ELSE ABS(t.amount)
        END
      )::bigint AS actual
    FROM transactions t
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = v_uid
      AND t.deleted_at IS NULL
      AND t.transaction_date >= v_start
      AND t.transaction_date <  v_end
      AND COALESCE(c.type, 'expense') <> 'transfer'
      -- p_as_of set: only posted rows dated on/before it (excludes projected,
      -- pending, and future-dated rows). NULL keeps every live row.
      AND (p_as_of IS NULL OR (t.status = 'posted' AND t.transaction_date <= p_as_of))
    GROUP BY t.category_id, c.name, c.color, c.type, c.sort_order
  ),
  merged AS (
    SELECT
      COALESCE(p.category_id, a.category_id) AS category_id,
      COALESCE(p.category_name, a.category_name) AS category_name,
      COALESCE(p.category_color, a.category_color) AS category_color,
      COALESCE(p.category_type, a.category_type) AS category_type,
      COALESCE(p.sort_order, a.sort_order, 999)  AS sort_order,
      COALESCE(p.planned, 0)::bigint AS planned,
      COALESCE(a.actual,  0)::bigint AS actual
    FROM planned p
    FULL OUTER JOIN actual a ON a.category_id = p.category_id
  )
  SELECT
    jsonb_agg(
      jsonb_build_object(
        'categoryId',    category_id,
        'categoryName',  category_name,
        'categoryColor', category_color,
        'categoryType',  category_type,
        'sortOrder',     sort_order,
        'planned',       planned,
        'actual',        actual
      )
      ORDER BY
        CASE category_type
          WHEN 'income'  THEN 0
          WHEN 'needs'   THEN 1
          WHEN 'wants'   THEN 2
          WHEN 'savings' THEN 3
          ELSE 4
        END,
        sort_order,
        category_name
    ),
    COALESCE(SUM(actual) FILTER (WHERE category_type = 'income'), 0)::bigint
  INTO v_categories, v_actual_inc
  FROM merged;

  RETURN jsonb_build_object(
    'categories',    COALESCE(v_categories, '[]'::jsonb),
    'plannedIncome', COALESCE(v_planned_inc, 0),
    'actualIncome',  COALESCE(v_actual_inc,  0)
  );
END;
$$;

DROP FUNCTION IF EXISTS get_monthly_spending_trend(integer, integer, integer);

CREATE OR REPLACE FUNCTION get_monthly_spending_trend(
  p_months    integer,
  p_end_month integer DEFAULT NULL,
  p_end_year  integer DEFAULT NULL,
  p_as_of     date    DEFAULT NULL
)
RETURNS TABLE (
  key         text,
  label       text,
  year        integer,
  month       integer,
  spent       bigint,
  income      bigint,
  tx_count    integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      COALESCE(
        (make_date(p_end_year, p_end_month, 1) + INTERVAL '1 month - 1 day')::date,
        CURRENT_DATE
      ) AS anchor_end
  ),
  bounds AS (
    SELECT
      anchor_end,
      (date_trunc('month', anchor_end) - make_interval(months => p_months - 1))::date AS start_d
    FROM params
  ),
  per_tx AS (
    SELECT
      t.transaction_date,
      EXTRACT(YEAR  FROM t.transaction_date)::integer AS y,
      EXTRACT(MONTH FROM t.transaction_date)::integer AS m,
      CASE
        WHEN t.is_income AND c.type = 'income' THEN 0::bigint
        WHEN NOT t.is_income AND c.type = 'income' THEN 0::bigint
        WHEN t.is_income AND c.type NOT IN ('income','transfer') THEN -ABS(t.amount)
        WHEN c.type = 'transfer' THEN 0::bigint
        ELSE ABS(t.amount)
      END AS spent_delta,
      CASE
        WHEN t.is_income AND c.type = 'income' THEN  ABS(t.amount)
        WHEN NOT t.is_income AND c.type = 'income' THEN -ABS(t.amount)
        ELSE 0::bigint
      END AS income_delta,
      CASE
        WHEN c.type = 'transfer' OR c.type = 'income' THEN 0
        ELSE 1
      END AS counts_as_spend
    FROM transactions t
    JOIN bounds b ON TRUE
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = auth.uid()
      AND t.deleted_at IS NULL
      AND t.transaction_date >= b.start_d
      AND t.transaction_date <= b.anchor_end
      -- p_as_of set: only posted rows dated on/before it (excludes projected,
      -- pending, and future-dated rows). NULL keeps every live row.
      AND (p_as_of IS NULL OR (t.status = 'posted' AND t.transaction_date <= p_as_of))
  )
  SELECT
    to_char(make_date(y, m, 1), 'YYYY-MM') AS key,
    to_char(make_date(y, m, 1), 'Mon YYYY') AS label,
    y AS year,
    m AS month,
    COALESCE(SUM(spent_delta),  0)::bigint AS spent,
    COALESCE(SUM(income_delta), 0)::bigint AS income,
    COALESCE(SUM(counts_as_spend), 0)::integer AS tx_count
  FROM per_tx
  GROUP BY y, m
  ORDER BY y, m;
$$;

DROP FUNCTION IF EXISTS get_yearly_spending_trend(integer, integer, integer);

CREATE OR REPLACE FUNCTION get_yearly_spending_trend(
  p_years     integer,
  p_end_month integer DEFAULT NULL,
  p_end_year  integer DEFAULT NULL,
  p_as_of     date    DEFAULT NULL
)
RETURNS TABLE (
  year      integer,
  spent     bigint,
  income    bigint,
  tx_count  integer
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      COALESCE(
        (make_date(p_end_year, p_end_month, 1) + INTERVAL '1 month - 1 day')::date,
        CURRENT_DATE
      ) AS anchor_end
  ),
  bounds AS (
    SELECT
      anchor_end,
      make_date(EXTRACT(YEAR FROM anchor_end)::integer - p_years + 1, 1, 1) AS start_d
    FROM params
  ),
  per_tx AS (
    SELECT
      EXTRACT(YEAR FROM t.transaction_date)::integer AS y,
      CASE
        WHEN t.is_income AND c.type = 'income' THEN 0::bigint
        WHEN NOT t.is_income AND c.type = 'income' THEN 0::bigint
        WHEN t.is_income AND c.type NOT IN ('income','transfer') THEN -ABS(t.amount)
        WHEN c.type = 'transfer' THEN 0::bigint
        ELSE ABS(t.amount)
      END AS spent_delta,
      CASE
        WHEN t.is_income AND c.type = 'income' THEN  ABS(t.amount)
        WHEN NOT t.is_income AND c.type = 'income' THEN -ABS(t.amount)
        ELSE 0::bigint
      END AS income_delta,
      CASE
        WHEN c.type = 'transfer' OR c.type = 'income' THEN 0
        ELSE 1
      END AS counts_as_spend
    FROM transactions t
    JOIN bounds b ON TRUE
    LEFT JOIN categories c ON c.id = t.category_id
    WHERE t.user_id = auth.uid()
      AND t.deleted_at IS NULL
      AND t.transaction_date >= b.start_d
      AND t.transaction_date <= b.anchor_end
      -- p_as_of set: only posted rows dated on/before it (excludes projected,
      -- pending, and future-dated rows). NULL keeps every live row.
      AND (p_as_of IS NULL OR (t.status = 'posted' AND t.transaction_date <= p_as_of))
  )
  SELECT
    y AS year,
    COALESCE(SUM(spent_delta),  0)::bigint AS spent,
    COALESCE(SUM(income_delta), 0)::bigint AS income,
    COALESCE(SUM(counts_as_spend), 0)::integer AS tx_count
  FROM per_tx
  GROUP BY y
  ORDER BY y;
$$;

COMMIT;
