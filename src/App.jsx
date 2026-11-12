import { lazy, Suspense, useCallback, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import SwipeableWrapper from './components/common/SwipeableWrapper';
import { AuthProvider } from './contexts/AuthContext';
import { SafeModeProvider } from './contexts/SafeModeContext';
import { ThemeProvider } from './contexts/ThemeContext';
import useSafeMode from './hooks/useSafeMode';
import useRoutePreload from './hooks/useRoutePreload';
import { getSupabaseBootstrapState } from './services/supabase';
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
const ServerSetupPage = lazy(() => import('./pages/ServerSetupPage'));

function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-50 via-amber-50/20 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-stone-200 border-t-amber-500 dark:border-stone-700 dark:border-t-amber-500" />
    </div>
  );
}

/**
 * Holds a protected page back (showing its skeleton) until the signed-in
 * user's safe-mode preference has loaded, so amounts are never rendered
 * unmasked for a user who has safe mode on.
 */
function SafeModeGate({ fallback, children }) {
  const { isReady } = useSafeMode();
  return isReady ? children : fallback;
}

/**
 * Phase 6: Per-page Suspense boundaries with skeleton fallbacks.
 * Each protected route gets its own <Suspense> with a layout-matched
 * skeleton so users see a meaningful placeholder instead of a generic spinner.
 */
function ProtectedPage({ fallback, children, serverReady }) {
  return (
    <ProtectedRoute serverReady={serverReady}>
      <SafeModeGate fallback={fallback}>
        <Suspense fallback={fallback}>
          <SwipeableWrapper>{children}</SwipeableWrapper>
        </Suspense>
      </SafeModeGate>
    </ProtectedRoute>
  );
}

function AppRoutes({ serverState, onServerConfigured }) {
  // Phase 6: preload next-likely route chunks in the background.
  useRoutePreload();
  const serverReady = serverState.status === 'ready';

  return (
    <Routes>
      <Route path="/" element={<Navigate to={serverReady ? '/app' : '/setup'} replace />} />
      <Route
        path="/setup"
        element={
          <Suspense fallback={<LoadingSpinner />}>
            <ServerSetupPage serverState={serverState} onConfigured={onServerConfigured} />
          </Suspense>
        }
      />
      <Route
        path="/auth"
        element={
          serverReady ? (
            <Suspense fallback={<LoadingSpinner />}>
              <AuthPage />
            </Suspense>
          ) : (
            <Navigate to="/setup" replace />
          )
        }
      />
      <Route path="/app" element={<Navigate to="/app/transactions" replace />} />
      <Route
        path="/app/categories"
        element={
          <ProtectedPage fallback={<CategoriesSkeleton />} serverReady={serverReady}>
            <CategoriesPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/transactions"
        element={
          <ProtectedPage fallback={<TransactionsSkeleton />} serverReady={serverReady}>
            <TransactionsPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/budgets"
        element={
          <ProtectedPage fallback={<BudgetSkeleton />} serverReady={serverReady}>
            <BudgetPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/accounts"
        element={
          <ProtectedPage fallback={<AccountsSkeleton />} serverReady={serverReady}>
            <AccountsPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/reports"
        element={
          <ProtectedPage fallback={<ReportsSkeleton />} serverReady={serverReady}>
            <ReportsPage />
          </ProtectedPage>
        }
      />
      <Route path="/app/dashboard" element={<Navigate to="/app/reports" replace />} />
      <Route
        path="/app/settings"
        element={
          <ProtectedPage fallback={<SettingsSkeleton />} serverReady={serverReady}>
            <SettingsPage />
          </ProtectedPage>
        }
      />
      <Route
        path="/app/splits"
        element={
          <ProtectedPage fallback={<SplitsSkeleton />} serverReady={serverReady}>
            <SplitExpensesPage />
          </ProtectedPage>
        }
      />
      <Route path="*" element={<Navigate to={serverReady ? '/auth' : '/setup'} replace />} />
    </Routes>
  );
}

/**
 * Phase 6: AuthProvider wraps all routes. It hoists auth state into a shared
 * context and pre-warms caches on first auth (replacing the eager pullAll
 * that previously ran in the App useEffect on every mount).
 *
 * SafeModeProvider and ThemeProvider sit below AuthProvider because their
 * preferences are per user and are (re)loaded when the signed-in user changes.
 *
 * Every successful server setup builds a new backend client (and possibly a
 * different auth adapter), so AuthProvider is remounted via `key` to re-check
 * the session and re-bind its auth listener to the current client.
 */
function App() {
  const [serverState, setServerState] = useState(() => getSupabaseBootstrapState());
  const [clientEpoch, setClientEpoch] = useState(0);
  const handleServerConfigured = useCallback(() => {
    setServerState(getSupabaseBootstrapState());
    setClientEpoch((epoch) => epoch + 1);
  }, []);

  return (
    <AuthProvider key={clientEpoch} enabled={serverState.status === 'ready'}>
      <SafeModeProvider>
        <ThemeProvider>
          <AppRoutes serverState={serverState} onServerConfigured={handleServerConfigured} />
        </ThemeProvider>
      </SafeModeProvider>
    </AuthProvider>
  );
}

export default App;
