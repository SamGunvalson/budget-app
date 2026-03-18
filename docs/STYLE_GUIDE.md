# Style Guide: Budget App

A warm, modern design system for consistent and approachable UI across the budget app.

**Design Philosophy**: Professional yet approachable, inspired by Wealthfront. Warm earth tones (amber, teal, stone), generous whitespace, elevated surfaces with shadows, subtle gradients, and smooth transitions.

---

## Color Palette

All colors use Tailwind CSS utilities. Use **stone** (warm gray) for neutrals, **amber** for primary actions, and **teal/emerald** for success/growth.

### Primary Colors

- **Primary Amber**: `text-amber-500`, `bg-amber-500`, `border-amber-500`
  - Use for: Primary buttons, active states, important CTAs, focus rings
  - Hover: `hover:bg-amber-600`
  - RGB: `#F59E0B`

- **Success Teal/Emerald**: `text-teal-500`, `bg-emerald-500`
  - Use for: Positive changes, income, growth indicators, feature icons
  - RGB: `#14B8A6` (teal), `#10B981` (emerald)

- **Secondary Violet**: `text-violet-500`, `bg-violet-500`
  - Use for: Reports, analytics accent
  - RGB: `#8B5CF6`

### Status Colors

- **Error Red**: `text-red-500`, `bg-red-50`, `border-red-200`
  - Use for: Errors, failed transactions, negative balances
  - Text on error bg: `text-red-700`

- **Warning Amber**: `text-amber-600`, `bg-amber-50`
  - Use for: Caution states, warnings

### Semantic Colors (Categories)

**Default category colors** (from DATA_MODEL.md):

- Income (earnings): `#10B981` (emerald)
- Needs (essential): `#EF4444` (red)
- Wants (discretionary): `#EC4899` (pink)
- Savings (goals): `#14B8A6` (teal)
- Transfer (non-budgeting): `#64748B` (slate)
- _Additional_:
  - Groceries: `#10B981` (emerald)
  - Utilities: `#F59E0B` (amber)
  - Transportation: `#8B5CF6` (violet)
  - Entertainment: `#06B6D4` (cyan)
  - Investments: `#6366F1` (indigo)

### Neutral Scale (Warm Stone)

- **Page Background**: `bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100`
- **Card Background**: `bg-white`
- **Borders**: `border-stone-200/60` (translucent for softer look)
- **Text Primary**: `text-stone-900`
- **Text Secondary**: `text-stone-600`
- **Text Tertiary**: `text-stone-500`
- **Text Muted**: `text-stone-400`
- **Input Background**: `bg-stone-50/50`

---

## Typography

Establish clear hierarchy with weight and size variations.

### Font Stack

```css
font-family:
  -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu",
  "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
```

_(Tailwind default - no custom font needed)_

### Type Scale

| Usage               | Tailwind Class           | Weight | Size | Line Height |
| ------------------- | ------------------------ | ------ | ---- | ----------- |
| **Page Title**      | `text-3xl font-bold`     | 700    | 30px | 1.333       |
| **Section Heading** | `text-2xl font-semibold` | 600    | 24px | 1.333       |
| **Subsection**      | `text-lg font-semibold`  | 600    | 18px | 1.333       |
| **Body Text**       | `text-base font-normal`  | 400    | 16px | 1.5         |
| **Label/Button**    | `text-sm font-medium`    | 500    | 14px | 1.43        |
| **Caption/Help**    | `text-xs font-normal`    | 400    | 12px | 1.5         |

### Examples

**Page Title**:

```jsx
<h1 className="text-3xl font-bold tracking-tight text-stone-900">
  Budget Overview
</h1>
```

**Section Heading**:

```jsx
<h2 className="text-2xl font-semibold text-stone-900 mt-6">
  Recent Transactions
</h2>
```

**Body Text**:

```jsx
<p className="text-base font-normal text-stone-600">
  Here's a description of what's happening.
</p>
```

**Help Text**:

```jsx
<p className="text-xs font-normal text-stone-400 mt-1">
  Enter the amount in dollars.
</p>
```

---

## Spacing & Layout

Use Tailwind's spacing scale consistently. **Balanced approach**: not too spacious, not too cramped.

### Spacing Scale

| Size | Tailwind    | Pixels | Use Case                          |
| ---- | ----------- | ------ | --------------------------------- |
| `xs` | `px-3 py-2` | 12/8   | Small buttons, tight spacing      |
| `sm` | `px-4 py-2` | 16/8   | Input fields, small buttons       |
| `md` | `px-6 py-3` | 24/12  | Regular buttons, moderate spacing |
| `lg` | `px-8 py-4` | 32/16  | Large buttons, section spacing    |

### Margins & Padding

**Section spacing**:

- Between major sections: `my-8` (32px)
- Between subsections: `my-6` (24px)
- Card internal padding: `p-6` (24px)
- Form field spacing: `space-y-4` (16px gap between fields)

**Example layout**:

```jsx
<div className="max-w-4xl mx-auto px-4">
  {/* Page title */}
  <h1 className="text-3xl font-bold tracking-tight text-stone-900 mb-8">
    Reports
  </h1>

  {/* Stat cards section */}
  <div className="grid grid-cols-3 gap-6 mb-8">{/* Cards */}</div>

  {/* Transactions section */}
  <div className="mt-8">
    <h2 className="text-2xl font-semibold text-stone-900 mb-6">Transactions</h2>
    {/* Content */}
  </div>
</div>
```

---

## Common Component Patterns

### Date Selection (Month/Year Persistence)

Any page or component with a month or year selector **must** use the shared `MonthYearContext` rather than local `useState` initialized from `getCurrentMonthYear()`. This ensures the selected period persists across page navigation and stays in sync app-wide.

**How it works:**

- `MonthYearProvider` (wraps the app in `main.jsx`) stores `month` and `year` in React state backed by `sessionStorage`.
- The selection survives navigation between pages and resets when the browser tab is closed.

**Usage:**

```jsx
import useMonthYear from '../hooks/useMonthYear';

export default function MyPage() {
  const { month, year, setMonthYear } = useMonthYear();

  // Pass to MonthYearSelector
  <MonthYearSelector month={month} year={year} onChange={(m, y) => setMonthYear(m, y)} />

  // Or for separate month/year callbacks (e.g. TransactionFilters)
  onMonthChange={(m) => setMonthYear(m, year)}
  onYearChange={(y) => setMonthYear(month, y)}

  // For year-only selectors (e.g. annual tables)
  onChange={(e) => { const ny = Number(e.target.value); setYear(ny); setMonthYear(month, ny); }}
}
```

**Rules:**

1. Never call `getCurrentMonthYear()` directly in a page/component to initialize month/year state — use `useMonthYear()` instead.
2. Always call `setMonthYear(m, y)` when the user changes the period so the context and `sessionStorage` stay in sync.
3. Components that accept month/year as props from a parent (e.g. `PlanVsActual` embedded in `ReportsPage`) should fall back to the context value when no prop is provided.

**Files following this pattern:** `ReportsPage`, `TransactionsPage`, `BudgetForm`, `PlanVsActual`, `AnnualActualsTable`, `AnnualBudgetTable`.

---

### Buttons

**Primary Button** (main call-to-action):

```jsx
<button className="rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-200/50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 active:scale-[0.98]">
  Add Transaction
</button>
```

**Secondary Button** (less prominent action):

```jsx
<button className="rounded-lg border border-stone-200 bg-white px-6 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2">
  Cancel
</button>
```

**Danger Button** (destructive action):

```jsx
<button className="rounded-xl bg-red-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-200/50 transition-all hover:bg-red-600 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 active:scale-[0.98]">
  Delete
</button>
```

**Button States**:

- **Disabled**: `opacity-50 cursor-not-allowed shadow-none`
- **Loading**: Show spinner inside button
- **Small variant**: Use `px-4 py-1.5 text-sm` instead of `px-6 py-2.5`
- **Press feedback**: `active:scale-[0.98]`

#### Reports Page — Tab & Sub-Button Color Matrix

The Reports page (`ReportsPage`) uses a tab bar where each section has an assigned accent color. **Sub-buttons within a section must use that same accent for their active state**, so the UI feels cohesive when navigating between views.

| Section            | Tab active color                | Sub-button active color                                          | Shadow token            |
| ------------------ | ------------------------------- | ---------------------------------------------------------------- | ----------------------- |
| **Summary**        | `bg-amber-500`                  | `bg-amber-500`                                                   | `shadow-amber-200/50`   |
| **Plan vs Actual** | `bg-emerald-500`                | `bg-emerald-500`                                                 | `shadow-emerald-200/50` |
| **Trends**         | `bg-sky-500`                    | `bg-sky-500`                                                     | `shadow-sky-200/50`     |
| **Annual Actuals** | `bg-violet-500 → bg-purple-500` | Year selector → `border-violet-200/300`, `focus:ring-violet-500` | `shadow-violet-200/50`  |

When adding new sub-controls inside a Reports section, reference this table to pick the correct active color.

### Form Inputs

**Text Input**:

```jsx
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-stone-700">
    Description
  </label>
  <input
    type="text"
    className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
    placeholder="What is this for?"
  />
</div>
```

**Number Input** (for amounts):

```jsx
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-stone-700">
    Amount (dollars)
  </label>
  <input
    type="number"
    step="0.01"
    className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
    placeholder="0.00"
  />
  <p className="text-xs text-stone-400">Enter amount in dollars</p>
</div>
```

**Dropdown/Select**:

```jsx
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-stone-700">Category</label>
  <select className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500">
    <option>Select a category...</option>
    <option>Groceries</option>
    <option>Rent</option>
  </select>
</div>
```

**Date Input**:

```jsx
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-stone-700">Date</label>
  <input
    type="date"
    className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
  />
</div>
```

**Form Layout**:

```jsx
<form className="space-y-4">
  {/* Input fields use space-y-4 for 16px gap */}
  <input />
  <input />
  <select />

  {/* Form actions */}
  <div className="flex gap-3 pt-4">
    <button className="flex-1 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600">
      Save
    </button>
    <button className="flex-1 rounded-lg border border-stone-200 bg-white px-6 py-2 text-sm font-medium text-stone-600 transition-all hover:bg-stone-50">
      Cancel
    </button>
  </div>
</form>
```

### Cards

**Stat Card** (report stats):

```jsx
<div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30">
  <p className="text-sm font-medium text-stone-500 mb-2">Total Spent</p>
  <p className="text-3xl font-bold text-stone-900">$1,234.56</p>
  <p className="text-xs text-stone-400 mt-2">This month</p>
</div>
```

**Feature/Action Card** (with icon and hover lift):

```jsx
<div className="group cursor-pointer rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-stone-200/50">
  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 transition-transform duration-300 group-hover:scale-110">
    {/* Icon SVG */}
  </div>
  <h2 className="text-lg font-semibold text-stone-900">Card Title</h2>
  <p className="mt-2 text-sm leading-relaxed text-stone-500">
    Card description goes here.
  </p>
</div>
```

**Container Card**:

```jsx
<div className="rounded-2xl border border-stone-200/60 bg-white p-6 shadow-md shadow-stone-200/30">
  <h3 className="text-lg font-semibold text-stone-900 mb-4">Section Title</h3>
  {/* Content */}
</div>
```

### Lists & Tables

**Simple List**:

```jsx
<div className="space-y-2">
  {items.map((item) => (
    <div
      key={item.id}
      className="flex items-center justify-between rounded-xl border border-stone-200/60 bg-white p-4 shadow-sm transition-all hover:shadow-md"
    >
      <p className="text-base text-stone-900">{item.name}</p>
      <p className="text-sm font-semibold text-stone-600">{item.value}</p>
    </div>
  ))}
</div>
```

**Table** (for transactions):

```jsx
<div className="overflow-x-auto rounded-2xl border border-stone-200/60 bg-white shadow-md shadow-stone-200/30">
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b border-stone-200">
        <th className="px-4 py-3 text-left font-semibold text-stone-600">
          Date
        </th>
        <th className="px-4 py-3 text-left font-semibold text-stone-600">
          Description
        </th>
        <th className="px-4 py-3 text-right font-semibold text-stone-600">
          Amount
        </th>
      </tr>
    </thead>
    <tbody>
      {rows.map((row) => (
        <tr
          key={row.id}
          className="border-b border-stone-100 transition-colors hover:bg-stone-50/50"
        >
          <td className="px-4 py-3 text-stone-900">{row.date}</td>
          <td className="px-4 py-3 text-stone-600">{row.description}</td>
          <td className="px-4 py-3 text-right text-stone-900 font-medium">
            {row.amount}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

### Alert/Message Components

**Success Message**:

```jsx
<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
  <p className="text-sm font-medium text-emerald-700">
    <span className="mr-1.5">✓</span>Transaction saved successfully
  </p>
</div>
```

**Error Message**:

```jsx
<div className="rounded-xl border border-red-200 bg-red-50 p-3">
  <p className="text-sm font-medium text-red-700">
    <span className="mr-1.5">⚠</span>Something went wrong. Please try again.
  </p>
</div>
```

**Info Message**:

```jsx
<div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
  <p className="text-sm font-medium text-amber-700">
    📝 Amounts are displayed in your default currency
  </p>
</div>
```

---

## Layout Patterns

### Page Layout

**Standard page structure** (sub-pages):

Every authenticated sub-page must follow this exact navigation pattern: a clickable "Budget App" logo+text linking back to the home page (`/app`), a vertical divider, the current page name, and a Sign Out button on the right.

```jsx
<div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100">
  {/* Navigation */}
  <nav className="sticky top-0 z-10 border-b border-stone-200/60 bg-white/80 shadow-sm backdrop-blur-md">
    <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
      <div className="flex items-center gap-3">
        <Link
          to="/app"
          className="flex items-center gap-3 transition-opacity hover:opacity-80"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-md shadow-amber-200/50">
            {/* $ Logo icon */}
          </div>
          <span className="text-lg font-bold text-stone-900">Budget App</span>
        </Link>
        {/* Vertical divider + page name breadcrumb */}
        <span className="hidden h-4 w-px bg-stone-300 dark:bg-stone-600 sm:block" />
        <span className="hidden text-sm font-medium text-stone-500 dark:text-stone-400 sm:block">
          Page Name
        </span>
      </div>
      {/* Sign out button — always on the right */}
      <button className="rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-medium text-stone-600 shadow-sm transition-all hover:bg-stone-50 hover:shadow-md ...">
        Sign out
      </button>
    </div>
  </nav>

  {/* Main content */}
  <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6">
    {/* Page heading */}
    <h1 className="text-3xl font-bold tracking-tight text-stone-900 mb-8">
      Page Title
    </h1>

    {/* Content grid/sections */}

    {/* Footer spacing */}
    <div className="mt-12" />
  </div>
</div>
```

#### Navigation rules

| Rule                         | Detail                                                                                                                                                                  |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Back navigation**          | Clicking "Budget App" in the nav bar returns to the home page. **Do not** add separate "← Back" buttons.                                    |
| **Breadcrumb label**         | Every sub-page displays a vertical divider (`\|`) followed by the page name after "Budget App" (e.g. `Budget App \| Accounts`). Hidden on small screens via `sm:block`. |
| **Home exception**           | The home page renders "Budget App" as plain text (not a `<Link>`) since the user is already there. No breadcrumb label is shown.                        |
| **Auth page**                | No navigation bar — only the logo badge and sign-in form.                                                                                                               |

### Browser Tab Title

Every page must set `document.title` via a `useEffect` on mount using the pattern `"Budget App | Page Name"`.

```jsx
useEffect(() => {
  document.title = "Budget App | Page Name";
}, []);
```

| Page           | `document.title`             |
| -------------- | ---------------------------- |
| Home           | `Budget App`                 |
| Accounts       | `Budget App \| Accounts`     |
| Budgets        | `Budget App \| Budgets`      |
| Categories     | `Budget App \| Categories`   |
| Transactions   | `Budget App \| Transactions` |
| Reports        | `Budget App \| Reports`      |
| Settings       | `Budget App \| Settings`     |
| Auth           | `Budget App \| Sign In`      |

The fallback `<title>` in `index.html` is `"Budget App"`.

### Grid Layouts

**Reports grid** (responsive):

```jsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  {/* Cards will stack on mobile, 2 columns on tablet, 3 on desktop */}
</div>
```

**Form layout** (single column):

```jsx
<div className="max-w-2xl">
  <form className="space-y-6">{/* Form fields */}</form>
</div>
```

---

## Accessibility & Interaction

### Focus States

All interactive elements should have clear focus states:

```jsx
focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2
```

### Hover States

Buttons and clickable items should have hover feedback:

```jsx
hover:bg-amber-600 transition-all
```

Cards should lift on hover:

```jsx
hover:-translate-y-1 hover:shadow-xl transition-all duration-300
```

### Disabled States

Disabled inputs and buttons:

```jsx
disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none
```

### Transitions & Animations

Use subtle transitions for state changes:

```jsx
transition-all duration-300   /* cards, hover effects */
transition-colors             /* simple color changes */
active:scale-[0.98]           /* button press feedback */
```

Custom entrance animations (defined in index.css):

```jsx
animate-fade-in       /* 0.5s opacity fade */
animate-fade-in-up    /* 0.5s fade + 12px upward slide */
```

Use `style={{ animationDelay: '100ms' }}` for staggered card entrances.

---

## Usage in AI Prompts

When asking AI to build components, reference this guide:

```
Create a React component for [feature].

Use the design patterns from STYLE_GUIDE.md:
- Color: Use amber-500 for primary actions, teal/emerald for success, red-500 for errors
- Neutrals: stone-900/600/500/400 instead of gray
- Typography: text-lg font-semibold for headings, text-base for body, tracking-tight on titles
- Spacing: Balanced layout with p-6 for cards, space-y-4 for form fields
- Cards: rounded-2xl, border-stone-200/60, shadow-md, hover:-translate-y-1
- Inputs: rounded-xl, bg-stone-50/50, focus:ring-amber-500
- Buttons: rounded-xl, shadow-md shadow-amber-200/50, active:scale-[0.98]
- Animations: animate-fade-in-up on content sections

Use Tailwind CSS. Reference existing components in src/components/
```

---

## Dark Mode

The app supports dark mode with **dark as the default**. The `.dark` class is toggled on `<html>` via `ThemeContext`. Users can switch between light and dark in **Settings → Appearance**.

### How It Works

1. **Tailwind v4 custom variant** — `@custom-variant dark (&:where(.dark, .dark *));` in `index.css`
2. **ThemeContext** (`src/contexts/ThemeContext.jsx`) — provides `isDark` (default `true`) and `toggleTheme()`
3. **Persistence** — theme preference is stored in Supabase via `getUserPreference('theme')` / `setUserPreference('theme', { dark: boolean })`
4. **Hook** — use `useTheme()` from `src/hooks/useTheme.js` to access `isDark` and `toggleTheme()` in any component

### Color Mapping Table

When adding `dark:` variants, follow this mapping consistently:

| Light Class                                                  | Dark Variant                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `bg-white`                                                   | `dark:bg-stone-800`                                                 |
| `bg-white/80` (nav overlays)                                 | `dark:bg-stone-900/80`                                              |
| `bg-stone-50/50` (inputs)                                    | `dark:bg-stone-700/50`                                              |
| `bg-stone-50` (section bg)                                   | `dark:bg-stone-700/30` or `dark:bg-stone-900`                       |
| `bg-stone-100` (icon wrappers)                               | `dark:bg-stone-700`                                                 |
| Page gradient `from-stone-50 via-amber-50/20 to-stone-100`   | `dark:from-stone-950 dark:via-stone-900 dark:to-stone-950`          |
| `text-stone-900`                                             | `dark:text-stone-100`                                               |
| `text-stone-800`                                             | `dark:text-stone-200`                                               |
| `text-stone-700`                                             | `dark:text-stone-300`                                               |
| `text-stone-600`                                             | `dark:text-stone-300` or `dark:text-stone-400`                      |
| `text-stone-500`                                             | `dark:text-stone-400`                                               |
| `text-stone-400`                                             | `dark:text-stone-500`                                               |
| `border-stone-200/60`                                        | `dark:border-stone-700/60`                                          |
| `border-stone-200`                                           | `dark:border-stone-700`                                             |
| `border-stone-300`                                           | `dark:border-stone-600`                                             |
| `shadow-stone-200/30`                                        | `dark:shadow-stone-900/50`                                          |
| `hover:bg-stone-50`                                          | `dark:hover:bg-stone-700`                                           |
| `focus:bg-white` (inputs)                                    | `dark:focus:bg-stone-700`                                           |
| `placeholder-stone-400`                                      | `dark:placeholder-stone-500`                                        |
| Error: `border-red-200 bg-red-50 text-red-700`               | `dark:border-red-800 dark:bg-red-950 dark:text-red-400`             |
| Success: `border-emerald-200 bg-emerald-50 text-emerald-700` | `dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-400` |
| Warning: `border-amber-200 bg-amber-50 text-amber-700`       | `dark:border-amber-800 dark:bg-amber-950 dark:text-amber-400`       |

### Adding Dark Mode to New Components

1. **Always pair light classes with `dark:` equivalents** using the mapping table above
2. **Accent colors** (amber, emerald, red, violet) generally work in both modes — only adjust bg-tinted containers (e.g., `bg-emerald-50` → `dark:bg-emerald-900/30`)
3. **Shadows** should shift from `shadow-stone-200/x` to `dark:shadow-stone-900/x`
4. **Borders** shift from `-stone-200` → `dark:-stone-700` (one step darker)
5. **Charts / SVGs** — Recharts tooltips need dark bg; axis tick colors are hardcoded (use neutral values like `#78716c` that work in both modes)
6. **Test both modes** — toggle the Settings switch to verify

### Quick Dark Mode Checklist

- [ ] Card / container: `dark:bg-stone-800 dark:border-stone-700/60 dark:shadow-stone-900/50`
- [ ] Title text: `dark:text-stone-100`
- [ ] Body text: `dark:text-stone-300`
- [ ] Subtle text: `dark:text-stone-400` or `dark:text-stone-500`
- [ ] Input: `dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100`
- [ ] Buttons (secondary): `dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300`
- [ ] Error/warning/success alerts include dark variants
- [ ] Table headers: `dark:bg-stone-700/30`
- [ ] Table dividers: `dark:border-stone-700`

---

## Quick Reference Checklist

Before considering a component "done":

- [ ] Colors use warm stone neutrals (not gray) and amber primary
- [ ] Typography follows hierarchy (varied weights, tracking-tight on titles)
- [ ] Spacing is balanced (not too crowded, not too loose)
- [ ] Buttons have hover/focus/active states with shadows
- [ ] Inputs have rounded-xl, subtle background, amber focus rings
- [ ] Cards use rounded-2xl, shadow-md, and hover lift
- [ ] Error/success messages use rounded-xl with appropriate colors
- [ ] Page uses gradient background (`from-stone-50 via-amber-50/20 to-stone-100`)
- [ ] Entrance animations applied (animate-fade-in-up)
- [ ] Mobile responsive (use `md:` and `lg:` breakpoints)
- [ ] Consistent with existing components
- [ ] Accessible (labels, focus states, contrast)
- [ ] **Dark mode**: All classes have `dark:` counterparts (see Dark Mode section)

---

**Style Guide Version**: 3.0
**Design Inspiration**: Wealthfront — warm earth tones, elevated surfaces
**Last Updated**: February 27, 2026
