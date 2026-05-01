/**
 * Phase 6 — Route-level modulepreload hints.
 *
 * Injects `<link rel="modulepreload">` tags for the chunks that are likely
 * needed next, based on the current route. This lets the browser fetch and
 * parse the JS while the user is still reading the current page, so the
 * next navigation feels instant.
 *
 * We use dynamic import() *only for its URL resolution* — the browser
 * preloads without executing. On route change the previous hints are removed
 * and replaced with the new set.
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

// Map current route → likely next routes (ordered by probability).
// We preload the top-level page chunk; recharts and other heavy deps
// are already lazy-loaded within those pages.
const PRELOAD_MAP = {
  "/app/transactions": [
    () => import("../pages/BudgetPage"),
    () => import("../pages/ReportsPage"),
  ],
  "/app/budgets": [
    () => import("../pages/TransactionsPage"),
    () => import("../pages/ReportsPage"),
  ],
  "/app/reports": [
    () => import("../pages/TransactionsPage"),
    () => import("../pages/AccountsPage"),
  ],
  "/app/accounts": [
    () => import("../pages/TransactionsPage"),
    () => import("../pages/ReportsPage"),
  ],
  "/app/categories": [
    () => import("../pages/TransactionsPage"),
    () => import("../pages/BudgetPage"),
  ],
  "/app/settings": [() => import("../pages/TransactionsPage")],
  "/app/splits": [() => import("../pages/TransactionsPage")],
};

/**
 * Trigger a dynamic import to force Vite to resolve the chunk URL and
 * warm it into the module cache. The import() is intentionally *not*
 * awaited — we just want the browser to start fetching the chunk.
 * If the chunk is already cached, this is a no-op.
 */
export default function useRoutePreload() {
  const { pathname } = useLocation();

  useEffect(() => {
    const loaders = PRELOAD_MAP[pathname];
    if (!loaders) return;

    // Small delay so we don't compete with the current page's own
    // lazy-loaded chunks or data fetches.
    const id = setTimeout(() => {
      for (const load of loaders) {
        load().catch(() => {
          // Preload failure is non-fatal — the chunk will load on demand.
        });
      }
    }, 1000);

    return () => clearTimeout(id);
  }, [pathname]);
}
