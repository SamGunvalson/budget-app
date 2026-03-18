# Phase 2: Budget Planning & Intelligent Dashboards (Week 2)

## 📍 Where You Are

**Phase 1 Complete** ✅

- ✅ Users can sign up/login
- ✅ Users can create and manage categories
- ✅ Users can add/edit/delete transactions
- ✅ Simple monthly summary dashboard

**Current Phase**: Phase 2 - Add budget planning and visualizations

---

## 🎯 Phase 2 Goals

**By the end of Phase 2, users can:**

1. Create monthly budgets with per-category allocations
2. See "Plan vs Actual" comparison (the differentiator feature)
3. Get visual alerts when spending exceeds budgets
4. View month-over-month spending trends
5. Understand where their money is actually going vs. where they planned

**Why Phase 2 matters**: This is where the app becomes genuinely useful. "Plan vs Actual" is what separates budget apps users *keep using* from ones they abandon.

---

## 🏗️ Architecture: What Changes

### Data Flow Recap

```
User → Login → Categories + Transactions + Budget Plans
        ↓
    Dashboard reads:
    - Budget Plans (what user PLANNED to spend)
    - Transactions (what user ACTUALLY spent)
    - JOIN → Display side-by-side
```

### New Queries You'll Write

1. **Get budget plan for a month** (fetch from budget_plans + budget_items)
2. **Get actual spending by category** (aggregate transactions)
3. **Combine them for Plan vs Actual** (the key query)
4. **Get month-over-month trend** (rolling 6-month summary)

All queries reference DATA_MODEL.md tables documented in Phase 1.

---

## 📋 Phase 2 Features

### Feature 1: Budget Plan Creation & Management (2-3 hours)

**Goal**: Users can create budgets for each month, allocating amounts to each category.

#### User Story

```
As a user, I want to:
- Set a budget for each month
- Allocate amounts to each category (Groceries: $400, Rent: $1200, etc.)
- Adjust budgets throughout the month
- See a monthly budget overview
```

#### Data Model Reference

From [DATA_MODEL.md](./DATA_MODEL.md):

**Tables to use:**

- `budget_plans`: month, year, total_income, created_at
- `budget_items`: budget_plan_id, category_id, planned_amount

**Example queries:**

```javascript
// Get or create budget plan for current month
const getBudgetPlan = async (userId, month, year) => {
  return await supabase
    .from('budget_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('month', month)
    .eq('year', year)
    .single();
};

// Get budget items (allocations) for a plan
const getBudgetItems = async (budgetPlanId) => {
  return await supabase
    .from('budget_items')
    .select('*, categories(name, color, type)')
    .eq('budget_plan_id', budgetPlanId)
    .order('created_at');
};
```

#### AI Context Pattern

```
Create a budget planning form component.

Data model (from DATA_MODEL.md):
- budget_plans table: id, user_id, month, year, total_income
- budget_items table: id, budget_plan_id, category_id, planned_amount
- categories table: id, name, color, type

Component needs:
1. Month/year selector (pre-fill current month)
2. Total income input field (convert to cents with toCents())
3. List of all user categories with input fields for planned amount
4. Save button - creates/updates budget plan + budget items
5. Display: Show form in cards, one per category

Functionality:
- Load existing budget if present for month/year
- If new month, autofill zeros
- Add/update budget items for each category
- Validate: planned_amount >= 0
- Save to Supabase

Use Supabase client from services/supabase.js
Use formatCurrency from utils/helpers.js
Use Tailwind CSS.
```

#### Files to Create

- `src/components/budgets/BudgetForm.jsx` - Main form
- `src/components/budgets/BudgetItemInput.jsx` - Per-category input
- `src/services/budgets.js` - API calls for budget operations
- `src/pages/BudgetPage.jsx` - Page containing budget form

#### Success Criteria

- [ ] User can see current month's budget (empty if first time)
- [ ] User can enter total income
- [ ] User can set planned amounts for each category
- [ ] Save button creates/updates budget plan and budget items
- [ ] On reload, budget data persists
- [ ] Displays total allocated vs total income
- [ ] Takes less than 1 second to load

---

### Feature 2: Plan vs Actual Dashboard (3-4 hours)

**Goal**: Show side-by-side comparison of what user planned to spend vs what they actually spent.

#### User Story

```
As a user, I want to:
- See a clear visual comparison of planned vs actual for each category
- Understand if I'm on track to stay within budget
- See month-over-month trends
- Get alerts if I'm overspending
```

#### Why This Matters

Most budget apps show either history OR planning. Almost none show them together. This is the feature that makes users keep coming back.

#### Data Model Reference

**Key Query**: Combine budget_plans + budget_items + transactions

```javascript
// Pseudo-code for the query:
SELECT
  categories.id, categories.name, categories.color,
  COALESCE(budget_items.planned_amount, 0) as planned,
  COALESCE(SUM(ABS(transactions.amount)), 0) as actual
FROM categories
LEFT JOIN budget_items ON budget_items.category_id = categories.id
LEFT JOIN budget_plans ON budget_plans.id = budget_items.budget_plan_id
LEFT JOIN transactions ON transactions.category_id = categories.id
WHERE categories.user_id = current_user
  AND budget_plans.month = selected_month
  AND EXTRACT(MONTH FROM transactions.transaction_date) = selected_month
GROUP BY categories.id, categories.name, categories.color, budget_items.planned_amount
```

#### AI Context Pattern

```
Create a "Plan vs Actual" dashboard component showing budget comparison.

Data model (from DATA_MODEL.md):
- budget_items: planned_amount
- transactions: amount (in cents), is_income, transaction_date
- categories: id, name, color

This component displays:
1. Bar chart comparing planned vs actual per category
2. Summary stats: total planned, total actual, difference
3. Category list showing: planned, actual, variance, %used

Key metrics:
- variance = actual - planned (negative = under budget, positive = over)
- percent_used = (actual / planned) * 100
- Alert if percent_used > 100 (over budget)

Chart library: Recharts BarChart with two bars per category (planned/actual)
Data structure: [
  { category: "Groceries", planned: 40000, actual: 35000 },
  { category: "Rent", planned: 120000, actual: 120000 }
]

Use formatCurrency from utils/helpers.js
Use Supabase queries for fetching data
Use Tailwind CSS for styling with details for STYLE_GUIDE.md
```

#### Files to Create

- `src/components/reports/PlanVsActual.jsx` - Main comparison view
- `src/components/reports/PlanVsActualChart.jsx` - Recharts component
- `src/components/reports/CategoryComparison.jsx` - Per-category rows
- `src/components/common/BudgetAlert.jsx` - Visual alert for over-budget
- `src/services/budgets.js` - Query for combined plan/actual data

#### Success Criteria

- [ ] Bar chart shows planned vs actual for all categories
- [ ] Categories are color-coded (matching category colors)
- [ ] Summary shows: total planned, total actual, variance
- [ ] Red alert appears if total actual > total planned
- [ ] Per-category alerts show if spent > planned
- [ ] Changes month/year selector updates chart immediately
- [ ] Chart loads in < 1 second

---

### Feature 3: Budget Alerts & Warnings (1-2 hours)

**Goal**: Warn users when they're approaching or exceeding budget limits.

#### User Story

```
As a user, I want:
- Visual warning when I spend 80% of a category budget
- Clear indication when I exceed a budget
- Breakdown showing which categories are at risk
```

#### Data Model Reference

From `budget_items`: Track which categories have planned budgets

#### AI Context Pattern

```
Create budget alert components and utilities.

Alerts needed:
1. Category-level: Show if spending >= 80% of planned
   - Color code: yellow (80-99%), red (100%+)
2. Overall: Show if total spending >= 80% of total planned
3. Display variance: "$50 over budget" or "$100 under"

Component: BudgetAlert displays:
- Alert icon (⚠️ for 80%, 🔴 for >100%)
- Category or total label
- Current vs planned amounts
- Variance text

Logic:
- Calculate percent_used = (actual / planned) * 100
- If percent_used >= 100: show red alert
- Else if percent_used >= 80: show yellow alert
- Else: show green checkmark

Use Tailwind CSS for color coding
Use formatCurrency from utils/helpers.js
```

#### Files to Create

- `src/components/common/BudgetAlert.jsx` - Alert component
- `src/components/reports/CategoryComparison.jsx` - Show alerts per-category
- `src/utils/budgetCalculations.js` - Helper functions for percent_used, variance

#### Success Criteria

- [ ] Yellow warning appears at 80% spent
- [ ] Red alert appears when over budget
- [ ] Variance text shows correctly ("$50 under" or "$75 over")
- [ ] Alerts update in real-time as transactions are added
- [ ] Alerts are visually distinct and easy to spot

---

### Feature 4: Monthly Trends & History (2-3 hours)

**Goal**: Show how spending patterns change over time (last 6 months).

#### User Story

```
As a user, I want to:
- See a spending trend over the last 6 months
- Compare this month to previous months
- Identify seasonal spending patterns
```

#### Data Model Reference

**Query**: Group transactions by month, sum by category or total

```javascript
// Pseudo-code:
SELECT
  EXTRACT(YEAR FROM transaction_date) as year,
  EXTRACT(MONTH FROM transaction_date) as month,
  SUM(amount) as total_spent,
  COUNT(*) as transaction_count
FROM transactions
WHERE user_id = current_user
  AND transaction_date >= CURRENT_DATE - INTERVAL '6 months'
  AND is_income = false
GROUP BY year, month
ORDER BY year DESC, month DESC
```

#### AI Context Pattern

```
Create a monthly trend chart component.

Data model (from DATA_MODEL.md):
- transactions table: amount (cents), transaction_date, is_income

This component shows:
1. Line chart of total spending per month (last 6 months)
2. Optional: Multiple lines per category
3. Summary: Average monthly spending, highest month, lowest month

Chart data structure:
[
  { month: "Jan", spent: 250000, budget: 300000 },
  { month: "Feb", spent: 280000, budget: 300000 },
  ...
]

Chart library: Recharts LineChart with two lines (actual vs planned budget)
or area chart to show visual difference

Use formatCurrency from utils/helpers.js
Use Supabase to fetch 6-month transaction data
Use Tailwind CSS for styling.
```

#### Files to Create

- `src/components/reports/TrendChart.jsx` - Line chart component
- `src/components/reports/TrendSummary.jsx` - Min/max/average stats
- `src/services/analytics.js` - Queries for trend data

#### Success Criteria

- [ ] Line chart shows last 6 months of spending
- [ ] Chart is readable (proper scales, labels)
- [ ] Summary shows average, highest, lowest months
- [ ] Hovering on data point shows exact amount
- [ ] Month labels are clear (Jan 2026, Feb 2026, etc.)

---

## 📚 Common Queries You'll Build

Keep these in `src/services/budgets.js`:

### Query 1: Get Budget Plan for Month

```javascript
export const getBudgetPlanForMonth = async (userId, month, year) => {
  const { data, error } = await supabase
    .from('budget_plans')
    .select('*, budget_items(*, categories(name, color))')
    .eq('user_id', userId)
    .eq('month', month)
    .eq('year', year)
    .single();
  
  if (error) throw error;
  return data;
};
```

### Query 2: Get Plan vs Actual for Month

```javascript
export const getPlanVsActual = async (userId, month, year) => {
  // This is a complex query that JOINs budgets + transactions
  // Suggested: Run in Supabase and make it a materialized view
  // Or fetch separately and combine in JavaScript
  
  const plan = await getBudgetPlanForMonth(userId, month, year);
  const actual = await getActualSpendingByCategory(userId, month, year);
  
  // Merge and return combined data
};
```

### Query 3: Get Monthly Trend

```javascript
export const getMonthlySpendings = async (userId, months = 6) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('transaction_date, amount')
    .eq('user_id', userId)
    .eq('is_income', false)
    .gt('transaction_date', new Date(Date.now() - months * 30 * 24 * 60 * 60 * 1000).toISOString())
    .order('transaction_date', { ascending: false });
  
  if (error) throw error;
  
  // Group by month in JavaScript
  return groupByMonth(data);
};
```

---

## 🛠️ Recommended Build Order

Build in this sequence to manage context and avoid rework:

1. **Budget Form** (Feature 1) - 2-3 hours
   - User can create/edit monthly budgets
   - Foundation for everything else

2. **Budget Queries** (Feature 2 prep) - 30 min
   - Write services/budgets.js with plan + actual queries
   - Test queries in Supabase SQL Editor first

3. **Plan vs Actual Chart** (Feature 2) - 2-3 hours
   - The core visualization
   - This is what makes Phase 2 special

4. **Budget Alerts** (Feature 3) - 1-2 hours
   - Add alerts to chart and dashboard

5. **Trend Chart** (Feature 4) - 2-3 hours
   - Nice-to-have, but valuable for users

6. **Polish & Refine** - 1-2 hours
   - Responsive design
   - Loading states
   - Error handling

---

## 📊 Working with AI: Examples for Phase 2

### Example 1: Budget Form Component

**Bad Prompt** ❌

```
Create a budget form
```

**Good Prompt** ✅

```
Create a monthly budget planning form component using React.

Data model (from DATA_MODEL.md):
- budget_plans table: id, user_id, month, year, total_income, created_at
- budget_items table: id, budget_plan_id, category_id, planned_amount
- categories table: (already created in Phase 1)

Requirements:
1. Load existing budget for selected month/year (or blank if new)
2. Form fields:
   - Month/year selector (use current month by default)
   - Total income input (in dollars, convert to cents with toCents())
   - For each active category: input field for planned amount
3. Display: Cards showing category name, color, input field
4. Validation: All amounts >= 0, description not empty
5. Save button: Creates/updates budget_plan + budget_items
6. On success: Show toast message

Files to reference:
- supabase.js for client
- helpers.js for toCents/formatCurrency
- DATA_MODEL.md for schema

Use Tailwind CSS for styling.
```

---

### Example 2: Plan vs Actual Query

**Bad Prompt** ❌

```
Write a query to compare plans and actuals
```

**Good Prompt** ✅

```
Write a JavaScript function that queries Supabase for "Plan vs Actual" data.

Data model (from DATA_MODEL.md):
- budget_plans: id, month, year
- budget_items: budget_plan_id, category_id, planned_amount
- transactions: user_id, category_id, amount (cents), transaction_date, is_income
- categories: id, name, color

Function signature:
getPlanVsActual(userId, month, year)

Should return:
[
  {
    category_id: "uuid",
    category_name: "Groceries",
    color: "#10B981",
    planned: 40000,    // cents
    actual: 35000,     // sum of |amounts| where is_income=false
    percent_used: 87.5 // (actual/planned)*100
  },
  ...
]

If category has no budget planned, include it with planned: 0.
If no transactions, actual: 0.

Handle edge case: planned = 0 (show actual, no percent).

Use Supabase client from services/supabase.js
```

---

### Example 3: Alert Component

**Bad Prompt** ❌

```
Create an alert component
```

**Good Prompt** ✅

```
Create a React BudgetAlert component that displays budget status.

Props:
{
  categoryName: string,
  planned: number (cents),
  actual: number (cents),
  variant: 'success' | 'warning' | 'danger'  // based on percent_used
}

Display:
- Icon: ✓ (green), ⚠️ (yellow), 🔴 (red)
- Text: "Groceries: $35 / $40 (87%)"
- Variance: "$5 under budget" or "$10 over budget"

Colors:
- success (< 80%): green background, green text
- warning (80-99%): yellow background, orange text
- danger (>= 100%): red background, red text

Use formatCurrency from utils/helpers.js to display amounts
Use Tailwind CSS for styling (bg-green-100, text-green-800, etc.)
```

---

## 🎯 End of Week 2 Goal

**Ship Phase 2 MVP**:

- ✅ Users can create monthly budgets
- ✅ Plan vs Actual chart displays correctly
- ✅ Budget alerts show when spending exceeds limits
- ✅ Monthly trend chart shows last 6 months
- ✅ All features responsive on mobile

**Dashboard flow**:

```
User logs in → Dashboard shows:
  - Select Month/Year
  - Plan vs Actual chart (bars, colors)
  - Total: planned, actual, variance
  - Category breakdown (color-coded alerts)
  - 6-month trend line chart
  - Link to edit budget
```

---

## 📖 Documentation

Reference these files frequently:

1. **[DATA_MODEL.md](./DATA_MODEL.md)** - Budget tables and queries
2. **[CONTEXT_GUIDE.md](./CONTEXT_GUIDE.md)** - How to ask AI questions
3. **[Recharts Docs](https://recharts.org)** - Chart examples
4. **[Supabase Docs](https://supabase.com/docs)** - Query patterns

---

## 🆘 Common Phase 2 Issues

### Chart Shows No Data

**Check:**

1. Budget exists for selected month? (Open Supabase Table Editor)
2. Transactions exist for selected month?
3. Transactions have correct category_id?
4. Query returns data? (Log in console before passing to chart)

**Debug:**

```javascript
// In your component
const data = await getPlanVsActual(userId, month, year);
console.log('Plan vs Actual data:', data); // Should be array of objects
```

### "Budget not found" Error

**Check:**

1. User created budget for that month? (Should redirect to budget form)
2. Query returns null? (Use `.single()` vs `.select()`)

**Fix:**

```javascript
// Create blank budget if not found
if (!budget) {
  budget = await createBudgetPlan(userId, month, year);
}
```

### Chart Formatting Wrong

**Check:**

1. Data structure matches chart expectations? (Log data before chart)
2. Amounts in cents or dollars? (Recharts expects just numbers)
3. All required fields present? (dataKey, fill, etc.)

---

## ✨ Tips

1. **Test queries in Supabase first** - Write and verify SQL in SQL Editor before coding
2. **Try one chart library feature at a time** - Don't try custom legends + tooltips + animations at once
3. **Commit after each feature** - Budget form works → commit. Chart works → commit.
4. **Share progress with friends** - "Here's my budget app" gets real feedback fast
5. **Don't overthink polish** - Phase 2 is MVP. Dark mode can wait for Phase 4.

---

## 🚀 Success Looks Like

**After Phase 2, you can:**

- [ ] Explain the data model to a friend
- [ ] Write Supabase queries without hallucinations (because you reference DATA_MODEL.md)
- [ ] Use AI to generate chart components efficiently
- [ ] Troubleshoot database issues independently
- [ ] Deploy a feature and watch users find it useful

**You learned:**

- How to structure queries for complex joins
- How to handle real-time data (transactions update → chart updates)
- How to work with visualization libraries
- How to scope AI conversations to avoid context pollution

---

**Ready to start Phase 2? Begin with Feature 1: Budget Form. Use the AI Context Pattern above to guide your prompt. Reference DATA_MODEL.md.**

Good luck! 🎯

---

**Phase 2 Guide Version**: 1.0  
**Last Updated**: February 27, 2026
