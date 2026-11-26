# UI Overhaul Plan

Status: Phase 1 in progress · 2026-11-26
References: [`mockups/mobile-transactions.html`](../mockups/mobile-transactions.html),
[`mockups/monthly-overview.html`](../mockups/monthly-overview.html)

## Goals

1. **Look:** forest/sage greens with gold accents, warm "paper" surfaces, and serif
   display titles, so the app feels more premium.
2. **Keep:** each page's accent color (Transactions amber, Splits pink, Accounts
   blue, Reports violet, Budgets teal, Settings neutral).
3. **Mobile:** the main actions (Add transaction, Quick/Templates) sit in a
   bottom dock that the thumb can reach.
4. **Order of work:** Phase 1 changes only colors and type. Later phases change
   layout and UX, one page at a time.

## What the mockups establish

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| paper (page) | `#f8f7f2` | `#171c19` | Page background. Replaces the stone→amber gradient. |
| panel (card) | `#fffefa` | `#202722` | Cards, nav bar, dock |
| ink | `#1f322a` | `#f1f3ea` | Primary text; the "inverse" button fill |
| soft | `#56665c` | `#b5c3b7` | Secondary text, labels |
| line | `#dbdfd4` | `#3a453d` | Borders and dividers |
| tint / wash | `#e4ece0` | `#313f33` | Secondary buttons, segmented controls, icon wells |
| forest | `#164b3c` | `#164739` | Hero cards, brand mark |
| gold | `#f3be53` / `#e7c985` | same | Primary CTA, brand mark accents, focus ring (`#b07c23` / `#ca8c2c`) |
| income | `#256449` | `#a7dbaf` | Positive amounts |
| warn | `#904119` on `#fae9d8` | `#f5b887` on `#49362c` | Over budget (burnt orange, kept separate from gold) |

Typography: serif display (`'Iowan Old Style', Baskerville, Georgia, serif`,
weight 400–500, tight `-0.04em` tracking) for H1 and hero numbers. Small-caps
eyebrows (11px, `0.1em` tracking, uppercase) above titles. Tabular numbers for all
amounts. Body text stays in the system sans font.

Layout: a brand bar, underline-tab navigation, eyebrow + serif title, rows
separated by hairlines instead of shadowed cards, and on mobile a bottom action
dock that respects `env(safe-area-inset-bottom)`.

## Current state (relevant facts)

- Tailwind v4 is configured from CSS (`src/index.css`). `tailwind.config.js` is
  **not loaded**: there is no `@config`. As a result,
  `animate-slide-up-mobile` (used in `SplitNotificationBell.jsx`) probably
  produces no CSS. Fix this in Phase 1 by moving it into `@theme`.
- Palette usage in `src/`: about 3,700 `stone-*`, 890 `amber-*`, 345 `emerald-*`,
  150 `violet-*`, and 106 `teal-*` class references.
- The page gradient is copy-pasted into 9 files.
- Chart and calendar components hard-code hex colors (about 13 files).
- Page accents live in `src/constants/pages.jsx` and are shared by the desktop
  nav, the mobile hamburger menu, and `MobilePageDots`.
- Mobile today: hamburger menu, swipe between pages, and page dots. On
  Transactions, "Quick" and "Recurring" are hidden behind a `<select>` labelled
  "More" on small screens, and the header holds a small "Add" button.
- `index.html` already sets `viewport-fit=cover`, and `--safe-area-top` exists.
  There is no bottom equivalent yet.
- There is no Overview/home page: `/app` redirects to `/app/transactions`.

---

## Phase 1: Colors and typography (no layout changes)

**Approach: change palette values at the token level instead of editing 3,700
class names.** Tailwind v4 lets `@theme` redefine built-in color scales.

1. **Re-tint `stone` to a sage/forest neutral scale** in `src/index.css`
   (`--color-stone-50` … `--color-stone-950`). Base it on the mockup values:
   50 ≈ paper, 100 ≈ tint, 200 ≈ line, 600 ≈ soft, 900 ≈ ink, and 900–950 ≈ the
   dark-mode greens. Every existing `bg-white` / `stone-*` pair from the
   dark-mode table then turns green-tinted in both themes.
2. **Warm `amber` toward gold.** Keep the hue close enough that the
   Transactions tab still reads as amber. This respects the request to keep tab
   colors.
3. **Add semantic tokens for new code**, for example `--color-paper`,
   `--color-panel`, `--color-ink`, `--color-soft`, `--color-line`,
   `--color-forest`, `--color-gold`, and `--color-warn`. Use the `light-dark()`
   approach, or `.dark` overrides, to match the current `.dark` class toggle.
   Later phases move components onto these tokens, so "stone" no longer has to
   mean "sage".
4. **Replace the 9 copied gradients** with one `.app-bg` utility (paper color,
   optionally a faint forest vignette). Optionally replace `bg-white` cards with
   `bg-panel`.
5. **Brand mark:** switch the amber `$` gradient tile to the forest tile with
   gold bars from the overview mockup. Update the favicon/PWA icons and the
   Android adaptive icon to match.
6. **Serif display font:** add `--font-display` and apply it to page H1s and
   large money figures only.
7. **Warnings vs CTA:** over-budget and warning states move from amber to the
   burnt-orange `warn` token, so they no longer look like the gold buttons.
   This affects the Annual Actuals thresholds, `BudgetAlert`, and warning
   alerts.
8. **Charts:** gather hard-coded hex colors into one module (for example
   `src/constants/chartColors.js`). Re-tune the axis, grid, and tooltip colors
   to the new neutrals. Keep the category colors.
9. Add `font-variant-numeric: tabular-nums` to amount displays (a global
   utility).
10. **Docs:** rewrite STYLE_GUIDE sections *Color Palette*, *Typography*, *Dark
    Mode → Color Mapping Table*, and the page-background snippet. Update the
    *Styling* bullets in `.github/AGENTS.md`.

**Check:** take screenshots of every page in light and dark mode, before and
after. Check text contrast (soft-on-paper and gold-on-ink must meet WCAG AA).
Run `npm run verify`.
**Risk:** low. The change is easy to revert, and the class markup does not change.

## Phase 2: Mobile shell and bottom action dock

1. **`useLayoutMode()` hook.** It returns `'mobile'` when
   `matchMedia('(max-width: 639px)')` matches **or** when
   `Capacitor.isNativePlatform()` is true. Otherwise it returns `'desktop'`.
2. **Page actions registry.** Pages declare their primary and secondary actions
   once, through a small context such as `usePageActions([{ id, label, icon,
   onClick, variant }])`. Desktop renders them in the page header, as today.
   Mobile renders them in the dock. This removes the hidden `<select>` "More"
   workaround.
3. **`MobileActionDock` component.** It is fixed to the bottom, uses panel
   background with a top hairline, and has padding
   `max(14px, env(safe-area-inset-bottom))`. Buttons are at least 48px tall.
   The primary button is gold and fills the row; secondary buttons use the tint
   color. Add `--safe-area-bottom` beside `--safe-area-top` and pad page content
   so the dock never covers the last row.
   - Transactions: **Add transaction** · **Quick** (templates) · overflow
     (Recurring, Import)
   - Splits: **Add split** · Settle up
   - Accounts: **Add account** · Update balances
   - Budgets and Reports: month picker in the dock, or no dock
4. **Bottom sheets on mobile.** The New transaction, Quick, and Settle up modals
   open as full-height sheets that slide up, with their submit button pinned at
   the bottom. On desktop `Modal.jsx` keeps its current behavior; a
   `variant="sheet"` switches on mobile.
5. The dock hides while the on-screen keyboard is open (input focused) and while
   a sheet is open.

**Check:** test on the Android build and in mobile Safari/Chrome PWA (safe areas,
keyboard, swipe navigation still working).

## Phase 3: Page headers and navigation

1. **Page header component** (`PageHeader`): eyebrow (for example
   "November 2026") + serif H1 + actions slot (desktop only). This replaces the
   hand-written `text-3xl font-bold` headers and the "Track your income…"
   subtitles.
2. **Desktop nav:** brand bar + underline tabs (mockup style). The active
   underline and text use the page's existing accent from `pages.jsx`, so tab
   colors carry over.
3. **Mobile nav (decision needed):** either keep the hamburger, swipe, and dots,
   or switch to a **bottom tab bar** (5 icons in their accent colors) with the
   action dock stacked above it or merged into it. Recommendation: bottom tab
   bar, with page actions moved into a floating gold "+" that opens a small
   action sheet. This keeps the bottom area to one bar.
4. Update the STYLE_GUIDE *Page Layout* and *Navigation rules* (the
   "Budget App | Page" breadcrumb rule changes).

## Phase 4: Page-level redesigns (one PR per page)

Order these by how often each page is used:

1. **Transactions:** rows grouped by day ("Today · Nov 26") with a category icon
   well, payee, "Category · Account" sub-line, and right-aligned tabular amount.
   Income shows in green with a `+`. A segmented **Posted / Pending (n)**
   control. On mobile, tapping a row opens a full-screen editor (mockup) instead
   of a modal. Keep bulk-select on desktop.
2. **Budgets:** category rows with a thin progress track, "$X left" or an
   orange "$X over" chip, and "$used of $plan". `AnnualBudgetTable` needs a
   dedicated mobile view (cards per category) instead of horizontal scrolling.
3. **Accounts:** hairline lists; forest hero card for net worth / available
   to spend.
4. **Reports:** retheme the chart palette (violet accent kept); the serif title
   and eyebrow tabs.
5. **Splits / Settings / Categories / Auth / Server setup:** apply the shared
   components (low effort once 1–3 exist).

## Phase 5: Overview home page (optional, new feature)

This is the `monthly-overview` mockup: a forest hero card ("$X left in your
spending plan" with the tick progress bar), *Coming up* (upcoming recurring),
*Category watch* (top 3 categories by % used), and *Recent activity*. All of
these can come from existing hooks (budget allocations, recurring, transactions)
through `src/hooks/queries.js`, so no schema change is needed. Decide whether
`/app` lands here or stays on Transactions.

## Phase 6: Polish

Motion that respects `prefers-reduced-motion`; Capacitor Haptics on add and
confirm; skeletons restyled to the new surfaces; empty states; and the
PWA/Android splash screen colors.

---

## Should mobile and web split?

**Split the shell, not the pages.** One route tree and one data layer.

- Use CSS breakpoints for styling differences (most cases).
- Use `useLayoutMode()` only where the DOM structure truly differs: the nav, the
  action dock vs the header buttons, modal vs sheet, the transaction table vs the
  day-grouped list, and the annual budget table vs cards. Render one or the
  other, not both hidden.
- Treat Capacitor native as "mobile" even on tablets, unless a wide tablet layout
  is wanted later.
- Do not create separate `*Mobile.jsx` pages. Where a component's two layouts
  diverge, split it into `FooList.jsx` + `FooListMobile.jsx` that share hooks.

## Decisions (2026-11-26)

1. **Serif font:** bundle Newsreader (`@fontsource-variable/newsreader`, wght
   axis, about 60 KB for the Latin subset).
2. **Mobile nav:** bottom tab bar (Phase 3.3), with page actions in a floating
   gold "+" action sheet.
3. **Overview page:** deferred. Phase 5 is on hold.
4. **Palette name:** "Forest & Gold".

## Suggested PR sequence

1. Phase 1a: tokens + `stone`/`amber` re-tint + `.app-bg` + Tailwind config fix + style guide
2. Phase 1b: warn color, chart color module, brand mark/icons, serif font
3. Phase 2: layout-mode hook, page actions, mobile dock, sheets
4. Phase 3: PageHeader + nav
5. Phase 4: one PR per page
6. Phase 5–6 as wanted

Each PR: screenshots in light/dark at mobile and desktop widths, `npm run verify`,
and a `code-reviewer` pass.
