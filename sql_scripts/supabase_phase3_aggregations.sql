-- =============================================================================
-- Budget App — Phase 3: server-side aggregations + supporting indexes.
--
-- Replaces six client-side full-table scans with bounded SQL aggregations:
--   • get_account_balances           (was: paginate all transactions, sum)
--   • get_net_worth_history          (was: paginate all + monthly fold)
--   • get_account_balance_history    (was: paginate all + per-day walk)
--   • get_plan_vs_actual             (was: paginate month + merge in JS)
--   • get_plan_vs_actual_ytd         (was: paginate YTD + merge in JS)
--   • get_monthly_spending_trend     (was: paginate window + aggregateByMonth)
--   • get_yearly_spending_trend      (was: paginate window + aggregateByYear)
--   • get_transaction_years          (was: SELECT first row + JS year math)
--
-- All functions are SECURITY INVOKER so existing per-table RLS continues to
-- enforce row visibility (we never widen access).  Each function reads only
-- rows owned by the current user (auth.uid()).
--
-- Idempotent: safe to re-run.  Drops + recreates each function and uses
-- IF NOT EXISTS on indexes.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- Indexes that match the new access patterns
-- ─────────────────────────────────────────────────────────────────────────────

-- Used by get_account_balances + get_account_balance_history + get_net_worth_history.
-- Existing idx_transactions_account is on (account_id) only; this composite
-- supports range scans by transaction_date scoped to a single account.
CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions(user_id, account_id, transaction_date)
  WHERE deleted_at IS NULL;

-- Used by every aggregation that joins transactions → categories.
-- Existing idx_transactions_category is on (category_id) only; this composite
-- supports the typical "per-user, per-category, by date" trend queries.
CREATE INDEX IF NOT EXISTS idx_transactions_user_category_date
  ON transactions(user_id, category_id, transaction_date)
  WHERE deleted_at IS NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: which account types are assets vs liabilities?
-- Mirrors src/services/accounts.js#ACCOUNT_TYPES grouping.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _is_asset_account(p_type text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT p_type IN ('checking', 'savings', 'retirement', 'brokerage');
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. get_transaction_years
--    Returns a contiguous list of years from the user's earliest transaction
--    through (current_year + 1), giving budgets a one-year look-ahead.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_transaction_years();

CREATE OR REPLACE FUNCTION get_transaction_years()
RETURNS integer[]
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  min_year integer;
  max_year integer := EXTRACT(YEAR FROM CURRENT_DATE)::integer + 1;
  result   integer[];
BEGIN
  SELECT EXTRACT(YEAR FROM MIN(transaction_date))::integer INTO min_year
  FROM transactions
  WHERE user_id = auth.uid()
    AND deleted_at IS NULL;

  IF min_year IS NULL THEN
    min_year := EXTRACT(YEAR FROM CURRENT_DATE)::integer;
  END IF;

  SELECT array_agg(y ORDER BY y) INTO result
  FROM generate_series(min_year, max_year) AS y;

  RETURN result;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. get_account_balances
--    Returns one row per active account with the same shape the client
--    previously assembled in JS:
--      starting_balance, transaction_net (posted), balance,
--      pending_net, projected_balance, is_asset.
--    `p_projected_to_date` caps future-dated rows that contribute to
--    projected_balance.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_account_balances(date);

CREATE OR REPLACE FUNCTION get_account_balances(p_projected_to_date date DEFAULT NULL)
RETURNS TABLE (
  id                 uuid,
  user_id            uuid,
  name               text,
  type               text,
  starting_balance   bigint,
  is_active          boolean,
  closed_at          date,
  created_at         timestamptz,
  updated_at         timestamptz,
  transaction_net    bigint,
  balance            bigint,
  pending_net        bigint,
  projected_balance  bigint,
  is_asset           boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH today AS (SELECT CURRENT_DATE AS d),
  sums AS (
    SELECT
      t.account_id,
      -- Posted, on/before today → actual balance
      COALESCE(SUM(CASE
        WHEN t.status = 'posted' AND t.transaction_date <= today.d AND t.is_income
          THEN ABS(t.amount) END), 0) AS posted_income,
      COALESCE(SUM(CASE
        WHEN t.status = 'posted' AND t.transaction_date <= today.d AND NOT t.is_income
          THEN ABS(t.amount) END), 0) AS posted_expense,
      -- Pending → near-term projection
      COALESCE(SUM(CASE
        WHEN t.status = 'pending' AND t.is_income
          THEN ABS(t.amount) END), 0) AS pending_income,
      COALESCE(SUM(CASE
        WHEN t.status = 'pending' AND NOT t.is_income
          THEN ABS(t.amount) END), 0) AS pending_expense,
      -- Future projected: status=projected OR status=posted with future date,
      -- both capped by p_projected_to_date when supplied.
      COALESCE(SUM(CASE
        WHEN (
              t.status = 'projected'
              OR (t.status = 'posted' AND t.transaction_date > today.d)
            )
            AND t.is_income
            AND (p_projected_to_date IS NULL OR t.transaction_date <= p_projected_to_date)
          THEN ABS(t.amount) END), 0) AS projected_income,
      COALESCE(SUM(CASE
        WHEN (
              t.status = 'projected'
              OR (t.status = 'posted' AND t.transaction_date > today.d)
            )
            AND NOT t.is_income
            AND (p_projected_to_date IS NULL OR t.transaction_date <= p_projected_to_date)
          THEN ABS(t.amount) END), 0) AS projected_expense
    FROM transactions t CROSS JOIN today
    WHERE t.user_id = auth.uid()
      AND t.deleted_at IS NULL
    GROUP BY t.account_id
  )
  SELECT
    a.id,
    a.user_id,
    a.name,
    a.type,
    a.starting_balance,
    a.is_active,
    a.closed_at,
    a.created_at,
    a.updated_at,
    -- transaction_net (posted)
    CASE WHEN _is_asset_account(a.type)
      THEN COALESCE(s.posted_income, 0)  - COALESCE(s.posted_expense, 0)
      ELSE COALESCE(s.posted_expense, 0) - COALESCE(s.posted_income, 0)
    END AS transaction_net,
    -- balance = starting + posted_net
    a.starting_balance +
      CASE WHEN _is_asset_account(a.type)
        THEN COALESCE(s.posted_income, 0)  - COALESCE(s.posted_expense, 0)
        ELSE COALESCE(s.posted_expense, 0) - COALESCE(s.posted_income, 0)
      END AS balance,
    -- pending_net
    CASE WHEN _is_asset_account(a.type)
      THEN COALESCE(s.pending_income, 0)  - COALESCE(s.pending_expense, 0)
      ELSE COALESCE(s.pending_expense, 0) - COALESCE(s.pending_income, 0)
    END AS pending_net,
    -- projected_balance: closed accounts freeze at posted balance
    CASE WHEN a.closed_at IS NOT NULL THEN
      a.starting_balance +
        CASE WHEN _is_asset_account(a.type)
          THEN COALESCE(s.posted_income, 0)  - COALESCE(s.posted_expense, 0)
          ELSE COALESCE(s.posted_expense, 0) - COALESCE(s.posted_income, 0)
        END
    ELSE
      a.starting_balance
        + CASE WHEN _is_asset_account(a.type)
            THEN COALESCE(s.posted_income, 0)    - COALESCE(s.posted_expense, 0)
            ELSE COALESCE(s.posted_expense, 0)   - COALESCE(s.posted_income, 0) END
        + CASE WHEN _is_asset_account(a.type)
            THEN COALESCE(s.pending_income, 0)   - COALESCE(s.pending_expense, 0)
            ELSE COALESCE(s.pending_expense, 0)  - COALESCE(s.pending_income, 0) END
        + CASE WHEN _is_asset_account(a.type)
            THEN COALESCE(s.projected_income, 0) - COALESCE(s.projected_expense, 0)
            ELSE COALESCE(s.projected_expense, 0)- COALESCE(s.projected_income, 0) END
    END AS projected_balance,
    _is_asset_account(a.type) AS is_asset
  FROM accounts a
  LEFT JOIN sums s ON s.account_id = a.id
  WHERE a.user_id = auth.uid()
    AND a.is_active = TRUE
  ORDER BY a.type, a.name;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. get_net_worth_history
--    Returns a JSON object { history, projectedFuture } where each entry is
--    { yearMonth, label, netWorth, totalAssets, totalLiabilities }.
--    Folds posted+pending into the historical series; projected + future-dated
--    posted into the future series (capped by p_projected_to_date when set).
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_net_worth_history(date);

CREATE OR REPLACE FUNCTION get_net_worth_history(p_projected_to_date date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_today     date := CURRENT_DATE;
  v_current_m date := date_trunc('month', v_today)::date;
  v_earliest  date;
  v_latest    date;
  v_history   jsonb;
  v_future    jsonb;
BEGIN
  -- Earliest non-projected transaction month (anchors history start)
  SELECT date_trunc('month', MIN(transaction_date))::date INTO v_earliest
  FROM transactions
  WHERE user_id = v_uid
    AND deleted_at IS NULL
    AND status <> 'projected';

  IF v_earliest IS NULL THEN
    RETURN jsonb_build_object('history', '[]'::jsonb, 'projectedFuture', '[]'::jsonb);
  END IF;

  -- ── History: each month's closing balance from earliest → current month ──
  WITH RECURSIVE months(ym) AS (
    SELECT v_earliest
    UNION ALL
    SELECT (ym + INTERVAL '1 month')::date FROM months WHERE ym < v_current_m
  ),
  per_month AS (
    SELECT
      a.id        AS account_id,
      a.type      AS account_type,
      a.starting_balance,
      m.ym,
      COALESCE(SUM(CASE WHEN t.is_income THEN ABS(t.amount) END), 0) AS income,
      COALESCE(SUM(CASE WHEN NOT t.is_income THEN ABS(t.amount) END), 0) AS expense
    FROM accounts a
    CROSS JOIN months m
    LEFT JOIN transactions t
      ON t.account_id = a.id
     AND t.user_id    = v_uid
     AND t.deleted_at IS NULL
     AND t.status <> 'projected'
     AND date_trunc('month', t.transaction_date)::date = m.ym
    WHERE a.user_id = v_uid
      AND a.is_active = TRUE
    GROUP BY a.id, a.type, a.starting_balance, m.ym
  ),
  running AS (
    SELECT
      account_id,
      account_type,
      ym,
      starting_balance + SUM(
        CASE WHEN _is_asset_account(account_type) THEN income - expense
             ELSE expense - income END
      ) OVER (PARTITION BY account_id ORDER BY ym ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
    FROM per_month
  ),
  history_rows AS (
    SELECT
      ym,
      SUM(CASE WHEN _is_asset_account(account_type) THEN running_balance ELSE 0 END) AS total_assets,
      SUM(CASE WHEN _is_asset_account(account_type) THEN 0 ELSE running_balance END) AS total_liabilities
    FROM running
    GROUP BY ym
    ORDER BY ym
  )
  SELECT jsonb_agg(jsonb_build_object(
    'yearMonth',        to_char(ym, 'YYYY-MM'),
    'label',            to_char(ym, 'Mon ''YY'),
    'netWorth',         (total_assets - total_liabilities)::bigint,
    'totalAssets',      total_assets::bigint,
    'totalLiabilities', total_liabilities::bigint
  ) ORDER BY ym) INTO v_history
  FROM history_rows;

  -- ── Projected future: month-after-current → latest projected/future row ──
  SELECT MAX(transaction_date) INTO v_latest
  FROM transactions
  WHERE user_id = v_uid
    AND deleted_at IS NULL
    AND (
      status = 'projected'
      OR (status = 'posted' AND transaction_date > date_trunc('month', v_today + INTERVAL '1 month')::date - 1)
    )
    AND (p_projected_to_date IS NULL OR transaction_date <= p_projected_to_date);

  IF v_latest IS NULL OR v_latest < (v_current_m + INTERVAL '1 month')::date THEN
    RETURN jsonb_build_object(
      'history',         COALESCE(v_history, '[]'::jsonb),
      'projectedFuture', '[]'::jsonb
    );
  END IF;

  WITH RECURSIVE
  -- Closing balance at end of current month per account (asset baseline for projection)
  months_h(ym) AS (
    SELECT v_earliest
    UNION ALL
    SELECT (ym + INTERVAL '1 month')::date FROM months_h WHERE ym < v_current_m
  ),
  per_month_h AS (
    SELECT
      a.id        AS account_id,
      a.type      AS account_type,
      a.starting_balance,
      m.ym,
      COALESCE(SUM(CASE WHEN t.is_income THEN ABS(t.amount) END), 0) AS income,
      COALESCE(SUM(CASE WHEN NOT t.is_income THEN ABS(t.amount) END), 0) AS expense
    FROM accounts a
    CROSS JOIN months_h m
    LEFT JOIN transactions t
      ON t.account_id = a.id
     AND t.user_id    = v_uid
     AND t.deleted_at IS NULL
     AND t.status <> 'projected'
     AND date_trunc('month', t.transaction_date)::date = m.ym
    WHERE a.user_id = v_uid
      AND a.is_active = TRUE
    GROUP BY a.id, a.type, a.starting_balance, m.ym
  ),
  account_baseline AS (
    SELECT DISTINCT ON (account_id)
      account_id,
      account_type,
      starting_balance + SUM(
        CASE WHEN _is_asset_account(account_type) THEN income - expense
             ELSE expense - income END
      ) OVER (PARTITION BY account_id ORDER BY ym ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS baseline
    FROM per_month_h
    ORDER BY account_id, ym DESC
  ),
  -- Future month series: month after current → v_latest
  future_months(ym) AS (
    SELECT (v_current_m + INTERVAL '1 month')::date
    UNION ALL
    SELECT (ym + INTERVAL '1 month')::date FROM future_months
    WHERE ym < date_trunc('month', v_latest)::date
  ),
  per_future AS (
    SELECT
      a.id        AS account_id,
      a.type      AS account_type,
      ab.baseline,
      m.ym,
      COALESCE(SUM(CASE WHEN t.is_income THEN ABS(t.amount) END), 0) AS income,
      COALESCE(SUM(CASE WHEN NOT t.is_income THEN ABS(t.amount) END), 0) AS expense
    FROM accounts a
    CROSS JOIN future_months m
    LEFT JOIN account_baseline ab ON ab.account_id = a.id
    LEFT JOIN transactions t
      ON t.account_id = a.id
     AND t.user_id    = v_uid
     AND t.deleted_at IS NULL
     AND date_trunc('month', t.transaction_date)::date = m.ym
     AND (
       t.status = 'projected'
       OR (t.status = 'posted' AND t.transaction_date > v_today)
     )
     AND (p_projected_to_date IS NULL OR t.transaction_date <= p_projected_to_date)
    WHERE a.user_id = v_uid
      AND a.is_active = TRUE
    GROUP BY a.id, a.type, ab.baseline, m.ym
  ),
  running_future AS (
    SELECT
      account_id,
      account_type,
      ym,
      COALESCE(baseline, 0) + SUM(
        CASE WHEN _is_asset_account(account_type) THEN income - expense
             ELSE expense - income END
      ) OVER (PARTITION BY account_id ORDER BY ym ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_balance
    FROM per_future
  ),
  future_rows AS (
    SELECT
      ym,
      SUM(CASE WHEN _is_asset_account(account_type) THEN running_balance ELSE 0 END) AS total_assets,
      SUM(CASE WHEN _is_asset_account(account_type) THEN 0 ELSE running_balance END) AS total_liabilities
    FROM running_future
    GROUP BY ym
    ORDER BY ym
  )
  SELECT jsonb_agg(jsonb_build_object(
    'yearMonth',        to_char(ym, 'YYYY-MM'),
    'label',            to_char(ym, 'Mon ''YY'),
    'netWorth',         (total_assets - total_liabilities)::bigint,
    'totalAssets',      total_assets::bigint,
    'totalLiabilities', total_liabilities::bigint
  ) ORDER BY ym) INTO v_future
  FROM future_rows;

  RETURN jsonb_build_object(
    'history',         COALESCE(v_history, '[]'::jsonb),
    'projectedFuture', COALESCE(v_future,  '[]'::jsonb)
  );
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. get_account_balance_history
--    Daily running-balance series per account between p_start and p_end.
--    Returns one row per date with `balances` as a jsonb map { account_id: cents }
--    plus `total` = sum of balances.
--    Past dates: posted + pending only.  Future: include projected too.
--    `p_start` is clamped to the earliest transaction date for these accounts.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_account_balance_history(uuid[], date, date);

CREATE OR REPLACE FUNCTION get_account_balance_history(
  p_account_ids uuid[],
  p_start       date,
  p_end         date
)
RETURNS TABLE (
  date     date,
  balances jsonb,
  total    bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_today     date := CURRENT_DATE;
  v_effective date;
  v_earliest  date;
BEGIN
  IF p_account_ids IS NULL OR array_length(p_account_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Clamp start to earliest transaction date among these accounts
  SELECT MIN(transaction_date) INTO v_earliest
  FROM transactions
  WHERE user_id = v_uid
    AND deleted_at IS NULL
    AND account_id = ANY(p_account_ids);

  v_effective := GREATEST(p_start, COALESCE(v_earliest, p_start));

  RETURN QUERY
  WITH params AS (
    SELECT v_effective AS start_d, p_end AS end_d, v_today AS today_d
  ),
  -- Filter txns relevant to our window.  We need *all* prior txns to bootstrap
  -- the opening balance, so we start the window at the account's earliest
  -- transaction (handled implicitly by including everything ≤ end_d).
  filtered_tx AS (
    SELECT
      t.account_id,
      a.type AS account_type,
      a.starting_balance,
      t.transaction_date,
      t.amount,
      t.is_income
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    CROSS JOIN params p
    WHERE t.user_id = v_uid
      AND t.deleted_at IS NULL
      AND t.account_id = ANY(p_account_ids)
      AND t.transaction_date <= p.end_d
      -- Past projected rows are excluded; future projected/posted are kept.
      AND NOT (t.transaction_date <= p.today_d AND t.status = 'projected')
  ),
  -- Opening balance per account = starting + all signed txns strictly before v_effective
  opening AS (
    SELECT
      a.id AS account_id,
      a.starting_balance + COALESCE(SUM(
        CASE WHEN _is_asset_account(a.type)
          THEN CASE WHEN ft.is_income THEN ABS(ft.amount) ELSE -ABS(ft.amount) END
          ELSE CASE WHEN ft.is_income THEN -ABS(ft.amount) ELSE ABS(ft.amount) END
        END
      ), 0)::bigint AS opening_balance
    FROM accounts a
    LEFT JOIN filtered_tx ft
      ON ft.account_id = a.id
     AND ft.transaction_date < v_effective
    WHERE a.user_id = v_uid
      AND a.id = ANY(p_account_ids)
    GROUP BY a.id, a.starting_balance, a.type
  ),
  -- Daily delta per account inside the window
  daily AS (
    SELECT
      ft.account_id,
      ft.account_type,
      ft.transaction_date AS d,
      SUM(
        CASE WHEN _is_asset_account(ft.account_type)
          THEN CASE WHEN ft.is_income THEN ABS(ft.amount) ELSE -ABS(ft.amount) END
          ELSE CASE WHEN ft.is_income THEN -ABS(ft.amount) ELSE ABS(ft.amount) END
        END
      )::bigint AS delta
    FROM filtered_tx ft
    WHERE ft.transaction_date >= v_effective
    GROUP BY ft.account_id, ft.account_type, ft.transaction_date
  ),
  date_series AS (
    SELECT generate_series(v_effective, p_end, INTERVAL '1 day')::date AS d
  ),
  per_account AS (
    SELECT
      ds.d,
      a.id AS account_id,
      o.opening_balance + COALESCE(SUM(dl.delta) OVER (
        PARTITION BY a.id ORDER BY ds.d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ), 0) AS running
    FROM date_series ds
    CROSS JOIN accounts a
    JOIN opening o ON o.account_id = a.id
    LEFT JOIN daily dl ON dl.account_id = a.id AND dl.d = ds.d
    WHERE a.user_id = v_uid
      AND a.id = ANY(p_account_ids)
  )
  SELECT
    pa.d AS date,
    jsonb_object_agg(pa.account_id::text, pa.running) AS balances,
    SUM(pa.running)::bigint AS total
  FROM per_account pa
  GROUP BY pa.d
  ORDER BY pa.d;
END;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. get_plan_vs_actual
--    Returns {categories, plannedIncome, actualIncome} for a single month.
--    Mirrors the JS in src/services/budgets.js#getPlanVsActual exactly:
--      • merges budget_items (planned) with transactions (actual)
--      • skips transfer-type categories
--      • spending-credit (income flag in non-income cat) reduces actual
--      • income-debit (expense flag in income cat) reduces actual income
--      • categories sorted by income → needs → wants → savings, then sort_order
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_plan_vs_actual(integer, integer);

CREATE OR REPLACE FUNCTION get_plan_vs_actual(p_month integer, p_year integer)
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. get_plan_vs_actual_ytd
--    Same shape but aggregates planned (across all plans Jan..p_through_month)
--    and actual transactions YTD.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_plan_vs_actual_ytd(integer, integer);

CREATE OR REPLACE FUNCTION get_plan_vs_actual_ytd(p_year integer, p_through_month integer)
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. get_monthly_spending_trend
--    Returns one row per month in a rolling window of `p_months` ending at
--    p_end_month/p_end_year (defaults to current month).  Same accounting
--    rules as PvA: transfers excluded, spending-credits subtract, etc.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_monthly_spending_trend(integer, integer, integer);

CREATE OR REPLACE FUNCTION get_monthly_spending_trend(
  p_months    integer,
  p_end_month integer DEFAULT NULL,
  p_end_year  integer DEFAULT NULL
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


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. get_yearly_spending_trend
--    Same accounting rules, aggregated to calendar year.
-- ─────────────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_yearly_spending_trend(integer, integer, integer);

CREATE OR REPLACE FUNCTION get_yearly_spending_trend(
  p_years     integer,
  p_end_month integer DEFAULT NULL,
  p_end_year  integer DEFAULT NULL
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


-- ─────────────────────────────────────────────────────────────────────────────
-- Verification: list the new functions and confirm INVOKER mode.
-- =============================================================================

SELECT proname, prosecdef AS security_definer
FROM pg_proc
WHERE proname IN (
  'get_transaction_years',
  'get_account_balances',
  'get_net_worth_history',
  'get_account_balance_history',
  'get_plan_vs_actual',
  'get_plan_vs_actual_ytd',
  'get_monthly_spending_trend',
  'get_yearly_spending_trend',
  '_is_asset_account'
)
ORDER BY proname;
