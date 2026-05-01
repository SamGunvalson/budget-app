import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import SwipeableWrapper from './components/common/SwipeableWrapper';
import { AuthProvider } from './contexts/AuthContext';
import useRoutePreload from './hooks/useRoutePreload';
import {
  TransactionsSkeleton,
  BudgetSkeleton,
  ReportsSkeleton,
  AccountsSkeleton,
  CategoriesSkeleton,
  SettingsSkeleton,
  SplitsSkeleton,
} from './components/common/PageSkeletons';

const AuthPage = lazy(() => import('./pages/AuthPage'));
const CategoriesPage = lazy(() => import('./pages/CategoriesPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const TransactionsPage = lazy(() => import('./pages/TransactionsPage'));
const BudgetPage = lazy(() => import('./pages/BudgetPage'));
const AccountsPage = lazy(() => import('./pages/AccountsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SplitExpensesPage = lazy(() => import('./pages/SplitExpensesPage'));

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-amber-500 dark:border-stone-700 dark:border-t-amber-500" />
    </div>
  );
}

/**
 * Phase 6: Per-page Suspense boundaries with skeleton fallbacks.
 * Each protected route gets its own <Suspense> with a layout-matched
 * skeleton so users see a meaningful placeholder instead of a generic spinner.
 */
function ProtectedPage({ fallback, children }) {
  return (
    <ProtectedRoute>
      <Suspense fallback={fallback}>
        <SwipeableWrapper>{children}</SwipeableWrapper>
      </Suspense>
    </ProtectedRoute>
  );
}

function AppRoutes() {
  // Phase 6: preload next-likely route chunks in the background.
  useRoutePreload();

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/auth" element={<Suspense fallback={<LoadingSpinner />}><AuthPage /></Suspense>} />
      <Route path="/app" element={<Navigate to="/app/transactions" replace />} />
      <Route
        path="/app/categories"
        element={
          <ProtectedPage fallback={<CategoriesSkeleton />}>
            <CategoriesPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/transactions"
        element={
          <ProtectedPage fallback={<TransactionsSkeleton />}>
            <TransactionsPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/budgets"
        element={
          <ProtectedPage fallback={<BudgetSkeleton />}>
            <BudgetPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/accounts"
        element={
          <ProtectedPage fallback={<AccountsSkeleton />}>
            <AccountsPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/reports"
        element={
          <ProtectedPage fallback={<ReportsSkeleton />}>
            <ReportsPage />
          </ProtectedPage>
        }
      />
      <Route path="/app/dashboard" element={<Navigate to="/app/reports" replace />} />
      <Route
        path="/app/settings"
        element={
          <ProtectedPage fallback={<SettingsSkeleton />}>
            <SettingsPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/splits"
        element={
          <ProtectedPage fallback={<SplitsSkeleton />}>
            <SplitExpensesPage />
          </ProtectedPage>
        }
      />
      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
  );
}

/**
 * Phase 6: AuthProvider wraps all routes. It hoists auth state into a shared
 * context and pre-warms caches on first auth (replacing the eager pullAll
 * that previously ran in the App useEffect on every mount).
 */
function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
