# Context Management Guide: Working with AI on Budget App

This guide teaches you how to work effectively with AI assistants (like GitHub Copilot, Claude, ChatGPT) while building this project—avoiding hallucinations, context pollution, and variance.

## Core Principle: Context is Everything

**Success with AI = Good Context Management**

Not the model you use. Not how clever your prompts are. **Context**.

---

## The Three Context Problems

### 1. Too Little Context → Hallucinations

**Problem**: AI fills in gaps with guesses.

**Example**:

```
❌ BAD: "Create a transaction form"
```

AI will invent field names, data types, validation rules.

```
✅ GOOD: "Create a React component for adding transactions.
Reference DATA_MODEL.md - the transaction table has:
user_id, category_id, amount (cents), description,
transaction_date, is_income. Form should validate amount > 0."
```

### 2. Too Much Context → Pollution

**Problem**: Information from one task leaks into unrelated tasks.

**Example**: You spend an hour debugging TypeScript issues with date formatting. Then you ask AI to create a simple category selector component. AI generates it with complex date logic you don't need—because dates dominated the recent context.

**Solution**: Start fresh conversations for unrelated tasks.

### 3. Non-Determinism → Variance

**Problem**: Same prompt = different results each time.

**Example**: Ask "create a login form" 3 times, get 3 different authentication flows (session-based, JWT, OAuth).

**Solution**: Be extremely specific. Reference existing patterns.

---

## The Context Management Workflow

### Phase 1: Define (Before Talking to AI)

**Stop. Think. Define.**

1. **What exactly am I building?**
   - "A form to add transactions"
   - Not "transaction stuff"

2. **What data does it need?**
   - Open `DATA_MODEL.md`
   - Identify specific tables/fields

3. **What does "done" look like?**
   - "User can enter amount, select category, pick date, submit"
   - Be concrete

### Phase 2: Scope (One Feature at a Time)

**AI conversations should be SHORT (5-10 exchanges max).**

✅ **Good scope** (one conversation):

- Build the TransactionForm component
- Write the Supabase query for fetching monthly transactions
- Create the Plan vs Actual chart component

❌ **Bad scope** (don't do this in one conversation):

- Build the entire dashboard
- "Make the app work"
- "Add all the features"

### Phase 3: Provide (Give AI What It Needs)

**Copy-paste the relevant context into your prompt.**

#### Example: Building a Transaction Form

```
I'm building a React component to add new transactions.

Data model (from DATA_MODEL.md):
- Table: transactions
- Fields: user_id (UUID), category_id (UUID, FK to categories),
  amount (BIGINT, in cents), description (TEXT),
  transaction_date (DATE), is_income (BOOLEAN)
- Constraints: amount != 0

Requirements:
- Form fields: category dropdown, amount input (dollars),
  description, date picker, income/expense toggle
- Convert dollars to cents before saving (use toCents() from utils/helpers.js)
- Validate: amount > 0, description not empty, date not in future
- Submit: Call Supabase insert (reference services/supabase.js)
- On success: Clear form, show success message

Generate the React component using Tailwind CSS.
```

**Why this works:**

- ✅ Exact table/field names (no hallucination)
- ✅ Clear requirements
- ✅ References existing utilities
- ✅ Specific stack (React, Tailwind)

### Phase 4: Review (Always Review Before Running)

**Never blindly paste AI-generated code.**

Check:

1. **Field names match DATA_MODEL.md?**
2. **Using cents, not dollars, for amounts?**
3. **Proper error handling?**
4. **Imports correct?**
5. **Does logic make sense?**

### Phase 5: Iterate (Small Changes)

If something doesn't work:

```
❌ BAD: "It's broken, fix it"
```

```
✅ GOOD: "The form submits but I get Supabase error:
'null value in column user_id violates not-null constraint'.
I need to add the current user's ID. How do I get that from
the Supabase auth session?"
```

Specific error + specific question = useful answer.

---

## Practical Examples: Good vs Bad Prompts

### Example 1: Creating a Component

<table>
<tr>
<th>❌ Bad Prompt</th>
<th>✅ Good Prompt</th>
</tr>
<tr>
<td>

```
Create a dashboard component
```

</td>
<td>

```
Create a React dashboard component that displays:
1. Total spent this month (from transactions table,
   sum absolute values where is_income=false)
2. Total income this month
3. Net (income - spent)

Data: Query transactions table using Supabase client
from services/supabase.js. Filter by current month/year.

Display: Use Tailwind CSS cards. Format amounts with
formatCurrency() from utils/helpers.js.

Component should accept month/year as props.
```

</td>
</tr>
</table>

### Example 2: Database Query

<table>
<tr>
<th>❌ Bad Prompt</th>
<th>✅ Good Prompt</th>
</tr>
<tr>
<td>

```
Write a query to get spending by category
```

</td>
<td>

```
Write a Supabase query (JavaScript) to get spending
by category for a specific month/year.

Schema (from DATA_MODEL.md):
- transactions: id, user_id, category_id, amount (cents),
  transaction_date, is_income, deleted_at
- categories: id, name, color

Query should:
- Join transactions + categories
- Filter: user_id = current user, month/year = params,
  deleted_at IS NULL, is_income = false
- Group by category
- Return: { category_id, category_name, color, total_spent }
- Order by total_spent DESC

Use Supabase client from services/supabase.js
```

</td>
</tr>
</table>

### Example 3: Bug Fix

<table>
<tr>
<th>❌ Bad Prompt</th>
<th>✅ Good Prompt</th>
</tr>
<tr>
<td>

```
My chart isn't working
```

</td>
<td>

```
My Recharts BarChart isn't rendering.

Error in console:
"Warning: Received NaN for the `x` attribute"

Data structure I'm passing:
[
  { category: "Groceries", planned: 40000, actual: 35000 },
  { category: "Rent", planned: 120000, actual: 120000 }
]

Chart config:
<BarChart data={data}>
  <XAxis dataKey="category" />
  <YAxis />
  <Bar dataKey="planned" fill="#3B82F6" />
  <Bar dataKey="actual" fill="#10B981" />
</BarChart>

What's wrong?
```

</td>
</tr>
</table>

---

## Red Flags: When to Stop & Restart

### 🚩 Context Pollution Detected

**Signs:**

- AI suggests features you didn't ask for
- Code style suddenly changes
- AI references earlier problems in unrelated answers
- Prompt thread exceeds 10 exchanges

**Fix:** Start a fresh conversation. Clearly state: "This is a new, unrelated task."

### 🚩 Hallucination Detected

**Signs:**

- Field names that don't exist
- Functions that aren't imported
- APIs that don't match documentation

**Fix:**

1. Reference the source of truth (DATA_MODEL.md, library docs)
2. Copy-paste the actual schema/API into the prompt
3. Be explicit: "Use EXACTLY these field names..."

### 🚩 Variance Issues

**Signs:**

- Same prompt gives different results
- Inconsistent patterns across similar components

**Fix:**

1. Be more specific
2. Reference existing code: "Follow the same pattern as TransactionForm.jsx"
3. Establish conventions in a CONVENTIONS.md file, reference it

---

## Workflow Summary (Quick Reference)

**Starting a new feature:**

1. **Break it down**: What's the smallest shippable piece?
2. **Open DATA_MODEL.md**: What tables/fields do I need?
3. **Write requirements**: What does "done" look like?
4. **Craft prompt**:
   - What I'm building
   - Data model excerpt
   - Requirements (numbered list)
   - Existing utilities to use
   - Tech stack
5. **Review output**: Check against DATA_MODEL.md
6. **Test**: Run it, verify it works
7. **Iterate**: Small, specific follow-ups if needed

**If conversation gets long/messy:**

- Stop
- Ship what you have (even if incomplete)
- Start fresh conversation for next piece

**Golden rule:** Each conversation = one component or one feature.

---

## Context Files to Always Reference

Keep these open in separate tabs:

1. **DATA_MODEL.md** - Schema & types
2. **SETUP_GUIDE.md** - Config & environment
3. **STYLE_GUIDE.md** - Component patterns & design system

When asking AI for code, reference the relevant file:

> "Using the `transactions` table schema from DATA_MODEL.md..."

---

## Real Workflow Example

**Goal:** Build transaction list component

**Step 1: Define**

```
Task: Display list of transactions for current month
Done criteria:
- Shows all transactions, newest first
- Displays: date, description, category name, amount
- Color-coded: green for income, red for expenses
- Click to edit (opens edit form)
```

**Step 2: Gather Context**

Open DATA_MODEL.md, note:

- transactions table: id, amount, description, transaction_date, is_income
- Need to JOIN categories for category name
- Amounts stored in cents (use formatCurrency helper)

**Step 3: Craft Prompt**

```
Create a React component TransactionList that displays transactions.

Data model (DATA_MODEL.md):
- transactions: id, user_id, category_id, amount (cents),
  description, transaction_date, is_income
- categories: id, name, color

Query:
- Fetch transactions for a given month/year
- JOIN categories to get category name
- Order by transaction_date DESC

Display:
- Table with columns: Date, Description, Category, Amount
- Format dates with formatDate() from utils/helpers.js
- Format amounts with formatCurrency() from utils/helpers.js
- Income = green text, Expense = red text
- Click row to trigger onEdit(transaction) callback

Use Tailwind CSS for styling.
```

**Step 4: Review Output**

Check:

- ✅ Field names match DATA_MODEL.md?
- ✅ Uses formatCurrency/formatDate?
- ✅ Proper JOIN query?
- ✅ Handles loading/error states?

**Step 5: Test & Iterate**

Run it. If issues:

- Specific error messages to AI
- Reference what's expected vs. what's happening

---

## Advanced: Establishing Project Conventions

After building 2-3 components, create `CONVENTIONS.md`:

```markdown
# Project Conventions

## File Structure

- Components: PascalCase (TransactionForm.jsx)
- Services: camelCase (supabase.js)
- Utils: camelCase (helpers.js)

## React Patterns

- Use functional components + hooks
- Props: Destructure in function signature
- State: useState for local, no Redux/Zustand yet

## Styling

- Tailwind CSS utility classes
- Primary color: blue-600
- Success: green-600, Error: red-600

## Error Handling

- Show user-friendly messages (not raw errors)
- Log errors to console
- Use try/catch for async operations

## Data Model

- Always reference DATA_MODEL.md for field names
- Amounts always in cents (convert with toCents/toDollars)
- Dates: ISO 8601 strings from DB, Date objects in UI
```

Then reference it:

> "Create a category selector component. Follow conventions in CONVENTIONS.md."

---

## Measuring Success

You're doing it right if:

✅ AI-generated code rarely has field name errors  
✅ You can explain what every line does  
✅ Components follow consistent patterns  
✅ You're not rewriting the same component 3 times  
✅ Conversations are short (< 10 exchanges)

You need to adjust if:

❌ Constantly fixing hallucinated field names  
❌ Code style changes wildly between components  
❌ Spending more time debugging AI code than writing it yourself  
❌ Conversations spiral into 20+ exchanges

---

## TL;DR

1. **Define** before you prompt
2. **Reference** DATA_MODEL.md explicitly
3. **One feature** per conversation
4. **Check** output against source of truth
5. **Fresh conversation** if context gets messy

**Remember**: AI is a tool, not magic. Good inputs = good outputs.

---

**Document Version**: 1.0  
**Last Updated**: February 27, 2026
