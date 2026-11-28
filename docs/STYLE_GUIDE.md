# Style Guide: Budget App

**Forest & Gold**: a calm, premium design system for the budget app.

**Design Philosophy**: Quiet and premium. Sage/forest neutrals on warm "paper"
surfaces, gold for primary actions, serif display titles, generous whitespace,
hairline dividers, and restrained shadows. Each page keeps its own accent color.
Reference mockups: `mockups/mobile-transactions.html` and
`mockups/monthly-overview.html`. The rollout is tracked in
[UI_OVERHAUL_PLAN.md](./UI_OVERHAUL_PLAN.md).

---

## Color Palette

All colors use Tailwind CSS utilities. The theme lives in `src/index.css`:

- The built-in **`stone`** scale is re-tinted to sage/forest neutrals, and
  **`amber`** is re-tinted to gold, through `@theme`. Existing `stone-*` and
  `amber-*` classes therefore render in the Forest & Gold palette. Do not swap
  them for `gray`, `slate`, `zinc`, or `neutral`.
- The **accent hues** (`blue`, `sky`, `indigo`, `violet`, `purple`, `fuchsia`,
  `pink`, `rose`, `teal`, `cyan`, `emerald`, `green`, `lime`, `yellow`) are
  re-tinted to muted mid-tones from the Cashflow chart. They keep their
  Tailwind family but sit with forest & gold. Each `-500` is the anchor; other
  steps follow Tailwind's OKLCH lightness curve, so `-50` tints and `-700`
  text keep their usual contrast. `yellow` renders as **clay** (gold belongs
  to `amber`), and `slate` aliases `stone`. `red` and `orange` keep their
  defaults for errors and warnings.
- Hex values for charts and category swatches live in
  `src/constants/palette.js` (`SERIES_COLORS`, `COLOR_FAMILIES`,
  `TYPE_COLORS`) and are re-exported for Recharts by
  `src/constants/chartColors.js`. `scripts/palette.test.js` fails if they
  drift from `index.css`. Do not hard-code Tailwind default hexes
  (`#10B981`, `#8B5CF6` …) in components.
- **Semantic tokens** switch automatically with `.dark`. Prefer them in new code:

| Token (utility suffix) | Light | Dark | Use |
| --- | --- | --- | --- |
| `paper` | `#f8f7f2` | `#171c19` | Page background (see `app-bg`) |
| `panel` | `#fffefa` | `#202722` | Cards, bars, docks |
| `ink` | `#1f322a` | `#f1f3ea` | Primary text, inverse button fill |
| `soft` | `#56665c` | `#b5c3b7` | Secondary text, labels |
| `line` | `#dbdfd4` | `#3a453d` | Borders, hairline dividers |
| `tint` | `#e4ece0` | `#313f33` | Secondary buttons, segmented controls, icon wells |
| `forest` | `#164b3c` | `#164739` | Hero cards, brand mark |
| `gold` | `#e7c985` | `#e7c985` | Brand mark bars, gold accents on forest |
| `income` | `#256449` | `#a7dbaf` | Positive amounts |
| `warn` / `warn-bg` | `#904119` / `#fae9d8` | `#f5b887` / `#49362c` | Over-budget text and chip |

Usage: `bg-paper`, `text-ink`, `border-line`, `bg-forest`, and so on. Opacity
modifiers work (`bg-forest/10`).

### Primary Colors

- **Primary Gold** (`amber` scale): `bg-amber-500` (`#eeb444`), hover `hover:bg-amber-600`
  - Use for: Primary buttons, active states, important CTAs, focus rings
  - **Text on gold is always dark**: `text-stone-950`. Never `text-white`,
    which fails contrast on gold.
  - Gold text on light backgrounds uses `text-amber-700` or darker.
  - No gradients on buttons; use a flat `bg-amber-500`.

- **Success Teal/Emerald**: `text-teal-500`, `bg-emerald-500`
  - Use for: Positive changes, income, growth indicators, feature icons
  - Hex: `#2a9d9a` (teal), `#3d9a6e` (emerald / jade)

- **Secondary Violet**: `text-violet-500`, `bg-violet-500`
  - Use for: Reports, analytics accent
  - Hex: `#8b6fc0`

### Navigation Accents

Navigation uses the destination icon's color, not the global primary amber:
Transactions = amber, Splits = pink, Accounts = blue, Reports = violet,
Budgets = teal, Settings = stone. Icons are always in their accent color. The
desktop active tab has an accent underline (`tabUnderline`). The mobile
active tab uses accent text plus a tinted pill (`tabActive`, `tabPill`).
Focus rings use `navFocus`. Keep the complete Tailwind classes in
`src/constants/pages.jsx` so Tailwind generates every variant. Primary CTAs
still use amber.

### Annual Actuals Highlights

Monthly expense cells compare actual cents with the category's allocation in
`useAnnualBudgetData(year)[month].allocations[categoryId]`. Use the saved budget
thresholds: emerald below the under-budget threshold, orange at/above warning,
red at/above danger, and neutral between under-budget and warning. Use
`bg-*-100` / `dark:bg-*-900/40` with `text-*-800` / `dark:text-*-300`
for readable status colors in both themes.

Missing or zero allocations with positive spending use a neutral italic
indicator with explicit light/dark text colors; these are not "on budget."
Income cells and annual totals remain neutral, and zero/zero cells are muted.
The legend must distinguish unbudgeted spending from the normal threshold range.

### Status Colors

- **Error Red**: `text-red-500`, `bg-red-50`, `border-red-200`
  - Use for: Errors, failed transactions, negative balances
  - Text on error bg: `text-red-700`

- **Warning Orange**: `text-orange-600`, `bg-orange-50`, `border-orange-200`
  (or the semantic `text-warn` / `bg-warn-bg`)
  - Use for: Caution states, warnings, budget-threshold "warning", over-budget chips
  - Do **not** use amber/gold for warnings; gold is reserved for primary actions.

### Semantic Colors (Categories)

Category colors come from `COLOR_FAMILIES` in `src/constants/palette.js`:
15 families (Rose, Coral, Clay, Gold, Olive, Sage, Jade, Teal, Sky, Blue,
Indigo, Violet, Plum, Orchid, Stone), each with four shades
(Pale / Light / Mid / Deep = the `300/400/500/700` steps of its Tailwind
scale). Users group related categories by giving them shades of one family.
The picker is `ColorPalettePicker`; bulk recoloring and moving old colors onto
the palette is `CategoryColorsModal` (Categories → Colors).

**Type colors** (`TYPE_COLORS` in `palette.js`; the dot and group-header
classes live in `src/constants/typeStyles.js`, never copied into components):

- Income: Jade `#3d9a6e` (`bg-emerald-500`)
- Needs: Ochre `#8f5f16` (`bg-amber-700`). The deep step reads brown, not the
  gold of primary buttons (`amber-500`).
- Wants: Orchid `#a86495` (`bg-fuchsia-500`)
- Savings: Blue `#4f86c6` (`bg-blue-500`)
- Transfer: Stone `#647167` (`stone`)

Type dots sit side by side, so this set was chosen with the dataviz palette
validator comparing **all pairs** in both themes; it is the only palette set
that passed. (The old coral needs / rose wants were ΔE 4 apart even with full
color vision.) Separation is in the colorblind floor band, so always show a
type color with its name. `scripts/palette.test.js` checks that each dot class
renders the `TYPE_COLORS` hex. Re-run the validator before changing any of them.

New categories default to their type's color until the user picks one.
Existing categories keep the colors they have.

### Neutral Scale (Warm Stone)

- **Page Background**: `app-bg` (paper color with a faint forest glow at the
  top; switches with dark mode by itself)
- **Card Background**: `bg-white` (or `bg-panel` in new code)
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

- **Body/UI**: Tailwind's default system sans stack (no change).
- **Display** (`font-display`): **Newsreader** variable serif, bundled through
  `@fontsource-variable/newsreader` (imported in `src/main.jsx`, precached by
  the PWA, and identical on Android). Fallbacks: Iowan Old Style, Baskerville,
  Georgia.
  - Use it for page H1s, the wordmark, and large hero money figures only.
    Never use it for body text, labels, or tables.
  - Use weight 400–600 (`font-medium` for titles). Serif type looks heavy at
    `font-bold`.
- **Numbers**: `tabular-nums` is set on `<body>`, so amounts line up in columns.
- **Eyebrow** (small label above a title): `text-[11px] font-semibold uppercase tracking-[0.1em] text-stone-500`.

### Type Scale

| Usage               | Tailwind Class           | Weight | Size | Line Height |
| ------------------- | ------------------------ | ------ | ---- | ----------- |
| **Page Title**      | `font-display text-3xl font-medium tracking-tight` | 500 | 30px | 1.333 |
| **Section Heading** | `text-2xl font-semibold` | 600    | 24px | 1.333       |
| **Subsection**      | `text-lg font-semibold`  | 600    | 18px | 1.333       |
| **Body Text**       | `text-base font-normal`  | 400    | 16px | 1.5         |
| **Label/Button**    | `text-sm font-medium`    | 500    | 14px | 1.43        |
| **Caption/Help**    | `text-xs font-normal`    | 400    | 12px | 1.5         |

### Examples

**Page Title**:

```jsx
<h1 className="font-display text-3xl font-medium tracking-tight text-stone-900 dark:text-stone-100">
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
  <h1 className="font-display text-3xl font-medium tracking-tight text-stone-900 mb-8">
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

### Optional amount calculator

Use `src/components/common/AmountInput.jsx` for calculator-enabled monetary
fields. It preserves native input props and normal numeric entry; the quiet
calculator icon opens a shared dialog rather than changing the field to a formula
editor. Supply a destination-specific `calculatorLabel`, `onAmountChange(value,
cents)`, and `minCents` (default 1; use 0 for budgets). `value` is an exact
two-decimal dollar string; `cents` is the integer value for existing save paths.
Use `calculatorValue` when the unfocused input displays a rounded amount, so the
calculator always starts from the exact current draft. Never seed math from a
safe-mode-masked display value.

Use `compact` for dense desktop grid cells: the icon appears on focus within the
input/control group and remains keyboard accessible. Mobile grid cells should
expose it in their existing edit dialog. For blur-to-commit editors, use
`onFieldBlur` instead of input `onBlur` so focus entering the calculator does not
commit the draft. The dialog uses the native modal top layer, contains focus,
blocks background interaction, and restores focus on close.

Calculation and **Use amount** never save the parent form. Keep explicit Save
actions, field-specific validation, disabled states, theme variants, and existing
offline write paths intact. Calculation drafts are local and are not persisted.

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
3. Components that accept month/year as props from a parent (e.g. `AnnualActualsTable` embedded in `ReportsPage`) should fall back to the context value when no prop is provided.

**Files following this pattern:** `ReportsPage`, `TransactionsPage`, `BudgetForm`, `AnnualActualsTable`, `AnnualBudgetTable`.

---

### Buttons

Use `Button` (`src/components/common/Button.jsx`), or `buttonClasses()` from
`src/utils/buttonClasses.js` for links and other elements that look like
buttons:

```jsx
<Button variant="primary" onClick={save}>Save changes</Button>
<Button variant="secondary" size="sm">Download</Button>
<Link to="/app/categories" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Go to Categories</Link>
```

| Variant | Look | Use for |
| --- | --- | --- |
| `primary` | Gold fill, dark text | **The one main action on a screen** (Add transaction, Save changes in a form, Sign in) |
| `secondary` | Panel fill, hairline border | Everything else: downloads, imports, per-card form submits, navigation-like actions |
| `ghost` | Text only, tint on hover | Low-emphasis inline actions, toolbar icons |
| `danger` | Red fill, white text | Destructive confirms (Delete) |

Sizes: `md` (default, `px-5 py-2.5`) and `sm` (`px-3.5 py-2`).

**Gold budget rule:** a screen gets at most one gold button, plus the one in
an open modal. Pages made of independent settings cards (Settings) use
`secondary` for every card action. If two actions compete for gold, the less
common one becomes `secondary`.

**Segmented controls** (Monthly / Yearly, Overview / Cashflow, 1Y / 3Y, filter
chips): the selected segment is **ink**, not gold:
`bg-stone-900 text-stone-50 shadow-sm dark:bg-stone-100 dark:text-stone-900`.
Unselected segments use `text-stone-500 hover:text-stone-700`. Use the shared
`SegmentedControl` component (`src/components/common/SegmentedControl.jsx`),
which also supports a `shortLabel` for narrow screens.

**Button States**:

- **Disabled**: `opacity-50 cursor-not-allowed` (built into `Button`)
- **Loading**: Change the label (e.g. "Saving…") or show a spinner inside the button
- **Press feedback**: `active:scale-[0.98]` (built into `Button`)

#### Reports Page — Tabs and control row

The Reports view tabs and every sub-control (Monthly / YTD, the trend range)
use the ink segmented control like the rest of the app. There are no colors
per tab. Violet, the Reports page accent, is kept for the nav, the "Needs
Review" badge and the Include-upcoming switch.

All views share one control row under the page header, and each view shows
only the controls that apply to it: period, month or year picker, trend range
and Include upcoming. Month and year pickers are `MonthYearSelector` and
`YearSelector`, with the standard gold focus ring.

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
    <button className="flex-1 rounded-xl bg-amber-500 px-6 py-2.5 text-sm font-semibold text-stone-950 shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600">
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

### Transaction rows

`TransactionList` renders a sortable table on wide screens and **compact
rows** when the list is narrower than 900px:

- **Compact row:** a 36px category badge (the category color at 18%, with its
  initial), the payee (semibold, 15px), and a "Category · Account" line below
  in `text-xs text-stone-500`. The amount is right-aligned in tabular figures,
  with the kebab menu at the end. A different description shows as the row's
  `title`.
- **Status chips:** `Pending` (amber chip) and `Planned` (stone chip) sit
  next to the payee. Other states (transfer, split, locked amount) stay as
  small icons on the sub-line.
- **Amounts:** income is `text-emerald-700 dark:text-emerald-400` with `+`.
  Expenses are **ink** (`text-stone-900 dark:text-stone-100`) with `−`, not
  red. Transfers are stone with `↑`/`↓`. Red is for errors and over-budget, not
  for ordinary spending.
- **Day headers** (when sorted by date): "Today · Nov 26", "Yesterday · Nov 25",
  then "Tue, Nov 24", in small uppercase on `bg-stone-50`.
- **Selection:** compact rows hide checkboxes until **Select** in the header is
  tapped, or any row is selected. Desktop always shows them.
- **Scrolling:** in mobile layout the list scrolls with the page (window
  virtualizer). There is no nested scroll box under the tab bar.
- **Status switch:** "All / Pending (n)" above the filters (`?status=pending`),
  with the selected segment in ink.

### Budget rows and progress

The monthly Budgets view (`BudgetForm` + `BudgetItemInput`) follows the
overview mockup:

- **Summary card:** a forest card (`bg-forest`, text `#fbfcf2`) with an eyebrow
  ("Left in / Over your spending plan"), a big serif amount, "$X spent of $Y
  budgeted", and a **tick progress bar** (a repeating-gradient mask: sage
  `#b8d9ac` fill, or peach `#f5b887` when over). Shown once a plan exists.
- **Groups:** an eyebrow heading with the type's colored dot (income emerald,
  needs red, wants pink, savings teal), a description, and "$spent of $planned"
  on the right. Rows sit in one panel with hairline dividers, not separate
  cards.
- **Row:** `CategoryWell`, name, "$X spent of $Y" (or "received" for income),
  and the amount input. Below it, a 6px track and a status on the right:
  - under plan: plain "$X left"
  - at or over the warning threshold: orange track; over plan gets an orange
    "$X over" chip
  - at or over the danger threshold: red track and a red chip
  - income: an emerald track, then "$X to go", "Received" or "+$X extra"
  - spending with no plan: an "Unbudgeted" chip

  Thresholds come from `useThresholds()`, and actuals from
  `usePlanVsActual(month, year)`.
- **Save bar:** sticky, floats at `bottom: calc(var(--bottom-chrome) + 12px)`,
  and only appears with unsaved changes (or for a new month). Otherwise the
  totals card shows planned income, allocated, and "To allocate".
- **Annual view on mobile:** one card per category with a 4×3 month grid.
  Tapping a month opens the same edit modal as the table. Edit Layout mode
  still uses the table.

### Summary (hero) cards

A page's headline number lives in a **forest summary card**: `rounded-2xl
bg-forest p-6 sm:p-7 text-[#fbfcf2] shadow-lg shadow-stone-900/10`.

- Eyebrow: `text-[11px] font-semibold uppercase tracking-[0.12em] text-[#d8e9d8]`.
- Number: `font-display text-5xl sm:text-6xl font-normal leading-none`.
- Supporting text: `text-sm text-[#daeadc]`. Positive accents are `#b8d9ac`;
  negative or over accents are `#f5b887`. Links on forest are gold `#e7c985`.
- Optional **tick bar**: a 16px bar with a repeating-gradient mask
  (`repeating-linear-gradient(90deg, #000 0 calc(2.5% - 2px), transparent calc(2.5% - 2px) 2.5%)`)
  over a two-color linear gradient, with a small legend below.
- Charts go in their own white panel below the card, not inside it.
- When the state is a warning (e.g. cash below cushion), use the red alert
  card instead of forest.
- A button on the forest card is **light**, not gold, so it doesn't compete
  with the page's gold action: `bg-[#fbfcf2] text-forest hover:bg-white`, with
  a gold focus ring (e.g. Splits → Settle Up).

Used by: Budgets (left in plan), Accounts (net worth), Accounts → Cashflow
(lowest cash), Splits (balance), and the Reports stat rows. Keep one forest
card per screen.

**Report stat rows** use `StatCards` (`src/components/reports/StatCards.jsx`):
the first card is the forest headline, and the rest are plain panels with an eyebrow label and an **ink**
figure. Don't color figures by meaning (no orange "actual", no red
"highest"); `negative: true` marks a bad outcome (peach on forest, red on
panels).

**Chart series:** income is emerald (`CHART_INCOME`). Spending is **violet**
(`CHART_SPENDING`, the Reports accent), never amber or orange, which mean
primary action and warning. Category charts keep each category's own color.
Charts that put category *types* side by side use `MIX_COLORS` from
`chartColors.js` (the type colors, plus olive for "Left in checking");
fixed / flexible use `FIXED_FLEX_COLORS`. Those sets passed the dataviz
palette validator in both themes; re-run it before changing them. One y-axis per chart (savings
rate gets its own small chart, not a second axis), legend text in the axis
color, legend items in stack order, and a 2px `CHART_SURFACE` stroke between
stacked segments.

**Section labels** above panels and lists use
`px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-600 dark:text-stone-300`.

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

Every authenticated page renders `TopBar`, then a centered content column that
starts with `PageHeader`:

```jsx
import TopBar from '../components/common/TopBar';
import PageHeader from '../components/common/PageHeader';
import { formatMonthYearLabel } from '../utils/helpers';

<div className="app-bg min-h-screen">
  <TopBar />
  <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <PageHeader eyebrow={formatMonthYearLabel(month, year)} title="Transactions">
      {/* Desktop-only header actions; mirror them with usePageActions for mobile */}
      <Button variant="primary" className="mobile:hidden">New Transaction</Button>
    </PageHeader>
    {/* content */}
  </div>
</div>
```

**`PageHeader`** (`src/components/common/PageHeader.jsx`):

- `eyebrow`: short context in small uppercase above the title. Use the
  period being viewed ("November 2026", "2026", "Pending review") or the
  page's domain ("Preferences", "Net worth & cashflow").
- `title`: serif, `text-3xl sm:text-4xl`. Keep it short; it is the page name.
- `description` (optional): one line of genuinely useful context (a partner's
  email, an archive hint). Don't use generic taglines like "Track your income
  and expenses."
- `children`: right-aligned actions. Default bottom margin is `mb-8`; pass
  `className` to change it.

The Reports page keeps a custom header because its controls are complex. It
uses the same eyebrow and title classes.

**`TopBar`** (desktop layout): a brand row (BrandMark + serif "Budget App"
wordmark, split-notification bell, sync status, Sign out). Below it is a row of
**underline tabs**: the icon in the accent color, the label in stone, and the
active tab is bold ink with a 2px accent underline. In mobile layout the tab
row is replaced by the bottom tab bar.

#### Navigation rules

| Rule | Detail |
| --- | --- |
| **Mobile navigation** | In mobile layout the top bar shows only the logo, status, and a "⋯" menu (Categories, Settings, Sign out). Page links are in the bottom tab bar. See *Mobile layout* below. |
| **Desktop navigation** | Underline tabs under the brand row. No page-name breadcrumb; the active tab and the `PageHeader` title identify the page. |
| **Back navigation** | Clicking "Budget App" returns to Transactions. **Do not** add separate "← Back" buttons. |
| **Auth page** | No navigation bar — only the brand mark, wordmark and sign-in form. |

### Mobile layout (bottom tab bar)

The layout mode is `mobile` below 1024px (Tailwind `lg`) **or** in the native
Android app at any width. Otherwise it is `desktop`. `src/utils/layoutMode.js`
mirrors it onto `<html data-layout>`, and `src/index.css` defines matching
Tailwind variants:

- `mobile:hidden` / `desktop:hidden` (and any utility, e.g. `mobile:items-end`):
  prefer these over `sm:`/`lg:` for anything that differs between the two
  shells, so phone, tablet and native behave the same way.
- `useLayoutMode()` (`src/hooks/useLayoutMode.js`): only when the DOM
  structure itself differs.

**Mobile shell** (`src/components/common/MobileChrome.jsx`, rendered by
`ProtectedPage` in `App.jsx`):

- **Bottom tab bar:** pages with `tabActive` in `src/constants/pages.jsx`
  (Transactions, Splits, Accounts, Reports, Budgets). The active tab uses the
  page accent (`tabActive` text + `tabPill` background). Settings, Categories
  and Sign out live in the top bar's "⋯" menu.
- **Page actions:** pages register their actions with `usePageActions([...])`
  (`src/hooks/usePageActions.js`). They render as floating buttons above the
  tab bar: `primary` is a gold pill with an icon and label (one per page, last
  in the array), `secondary` is a panel pill with an icon and label, and
  `icon` is a round 48px panel button with `aria-label` and optional
  `pressed`. Hide the same buttons in the desktop header with `mobile:hidden`
  so each action appears once.
- **Spacing:** MobileChrome sets `--bottom-chrome` and `<body>` pads by it.
  Don't add your own bottom padding for the tab bar.
- **Keyboard:** the tab bar and actions hide while a text field outside a
  dialog has focus.
- **Sheets:** `Modal` renders as a bottom sheet in mobile layout (slides up,
  scrolls inside, has a grab handle, and pads for the safe area). No per-modal
  work is needed.
- Swipe between pages still works. The top-bar page dots were removed.

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

**Never hide actions behind hover alone.** Touch screens have no hover. Row
actions that reveal on hover must stay visible on touch devices and when
focused:

```jsx
className="focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
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

**Reduced motion:** a global `@media (prefers-reduced-motion: reduce)` rule in
`index.css` collapses every animation and transition, including page slides,
fade-ins, bottom-sheet slide-ups and skeleton pulses. Don't add per-component
`motion-safe:` variants. Never make an animation the only way to tell that
something happened.

### Haptics (Android app)

`src/utils/haptics.js`: call `hapticSuccess()` after a save the user just
made (a transaction added, including Quick and transfers; a budget saved; a
split added; settled up). Call `hapticTap()` for small confirmations (a
pending transaction confirmed). Both do nothing on the web and never throw.
Call them after the save succeeds, never before.

### Empty states and loading

- **Empty lists:** use `EmptyState` (`src/components/common/EmptyState.jsx`) inside
  the list's panel: a stone icon well, a serif title, a one-line hint, and an
  optional action.
- **Data that failed to load:** never show zeros in place of missing figures.
  When `isQueryUnavailable(query)` (`src/utils/queryState.js`) is true, render
  `DataUnavailable` (`src/components/common/DataUnavailable.jsx`) with a Try
  again button instead of the figures, and leave that query's error out of the
  page's red banner so it isn't reported twice. Used by Transactions, Accounts,
  Budgets, and Reports' Categories tab. Cached data always wins:
  the card only appears when there's nothing to show.
- **Page loading:** `PageSkeletons.jsx` mirrors each page's real layout (top
  bar, eyebrow + title, forest summary card, hairline list panels). When a
  page's layout changes, update its skeleton.

### App icons and splash

All icons and Android splash screens come from `resources/brand/mark.svg` (the
full tile) and `resources/brand/bars.svg` (bars only, for full-bleed and
adaptive icons). After changing either, run `bash scripts/generate-icons.sh`
(needs ImageMagick 7). Don't edit the generated PNGs by hand.

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

The app supports dark mode with **dark as the default**. In dark mode, the re-tinted `stone` scale gives green-black surfaces (`stone-800` `#232b25`, `stone-900` `#1a211c`, `stone-950` `#121714`). The `.dark` class is toggled on `<html>` via `ThemeContext`. Users can switch between light and dark in **Settings → Appearance**.

### How It Works

1. **Tailwind v4 custom variant** — `@custom-variant dark (&:where(.dark, .dark *));` in `index.css`
2. **ThemeContext** (`src/contexts/ThemeContext.jsx`) — provides `isDark` (default `true`) and `toggleTheme()`
3. **Persistence** — the provider uses `getUserPreferenceOffline('theme')` /
   `setUserPreferenceOffline('theme', { dark: boolean })` from the
   [offline wrappers](../src/services/offlineAware.js), supporting the selected
   backend and offline sync
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
| Page background `app-bg`                                     | none needed (switches with `.dark`)                                 |
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
- [ ] Page root uses `app-bg min-h-screen`
- [ ] Entrance animations applied (animate-fade-in-up)
- [ ] Mobile responsive (use `md:` and `lg:` breakpoints)
- [ ] Consistent with existing components
- [ ] Accessible (labels, focus states, contrast)
- [ ] **Dark mode**: All classes have `dark:` counterparts (see Dark Mode section)

---

**Style Guide Version**: 4.1 (Forest & Gold)
**Design Inspiration**: quiet premium finance — forest/sage neutrals, gold accents, serif display
**Last Updated**: November 26, 2026
