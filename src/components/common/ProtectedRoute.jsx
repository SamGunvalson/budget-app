import { Navigate, useLocation } from 'react-router-dom';
import useAuth from '../../hooks/useAuth';

/**
 * Phase 6: ProtectedRoute now reads from the shared AuthProvider context
 * instead of calling supabase.auth.getSession() on every mount.
 * This eliminates a per-route JWT validation round-trip.
 */
function ProtectedRoute({ children, serverReady = true }) {
  const location = useLocation();
  const { session, isChecking } = useAuth();

  if (!serverReady) {
    return <Navigate to="/setup" state={{ from: location }} replace />;
  }

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-stone-900">
        <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-6 py-3 dark:border-stone-700 dark:bg-stone-800">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <span className="text-sm font-medium text-gray-700 dark:text-stone-300">Checking your session...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }

  return children;
}

export default ProtectedRoute;
