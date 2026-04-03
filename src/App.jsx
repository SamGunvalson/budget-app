import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/common/ProtectedRoute';
import { initializeRecurringCycle } from './services/recurring';
import { startSyncListener, pullAll } from './services/sync';
import SwipeableWrapper from './components/common/SwipeableWrapper';

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

function App() {
  // On mount: generate projected transactions, promote due ones, auto-confirm
  useEffect(() => {
    document.title = 'Budget App';
    initializeRecurringCycle({ windowDays: 180 }).catch((err) => {
      console.warn('Recurring cycle init failed:', err?.message || err);
    });
    pullAll().catch((err) => console.warn('Initial pull failed:', err?.message || err));
    startSyncListener();
  }, []);

  return (
    <Suspense fallback={<LoadingSpinner />}>
    <Routes>
      <Route path="/" element={<Navigate to="/app" replace />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/app" element={<Navigate to="/app/transactions" replace />} />
      <Route
        path="/app/categories"
        element={
          <ProtectedRoute>
            <SwipeableWrapper><CategoriesPage /></SwipeableWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/transactions"
        element={
          <ProtectedRoute>
            <SwipeableWrapper><TransactionsPage /></SwipeableWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/budgets"
        element={
          <ProtectedRoute>
            <SwipeableWrapper><BudgetPage /></SwipeableWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/accounts"
        element={
          <ProtectedRoute>
            <SwipeableWrapper><AccountsPage /></SwipeableWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/reports"
        element={
          <ProtectedRoute>
            <SwipeableWrapper><ReportsPage /></SwipeableWrapper>
          </ProtectedRoute>
        }
      />
      <Route path="/app/dashboard" element={<Navigate to="/app/reports" replace />} />
      <Route
        path="/app/settings"
        element={
          <ProtectedRoute>
            <SwipeableWrapper><SettingsPage /></SwipeableWrapper>
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/splits"
        element={
          <ProtectedRoute>
            <SwipeableWrapper><SplitExpensesPage /></SwipeableWrapper>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/auth" replace />} />
    </Routes>
    </Suspense>
  );
}

export default App;
