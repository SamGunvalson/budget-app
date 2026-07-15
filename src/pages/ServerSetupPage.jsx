import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { configureServer, testServer } from '../services/supabase';
import { getConnectionErrorMessage } from '../utils/connectionErrors';

export default function ServerSetupPage({ serverState, onConfigured }) {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = location.state?.from?.pathname || '/auth';
  const currentServer = serverState?.serverOrigin || '';

  const [serverInput, setServerInput] = useState(currentServer);
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState('');
  const [error, setError] = useState('');
  const [successDetail, setSuccessDetail] = useState('');

  const hasChanged = useMemo(
    () => serverInput.trim() !== currentServer.trim(),
    [serverInput, currentServer],
  );

  const handleTestConnection = async () => {
    setError('');
    setTestResult('');
    setSuccessDetail('');
    setIsTesting(true);

    try {
      const result = await testServer(serverInput);
      setTestResult('success');
      setSuccessDetail(`Connected to ${result.serverOrigin}`);
    } catch (connectionError) {
      setTestResult('error');
      setError(getConnectionErrorMessage(connectionError));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setTestResult('');
    setSuccessDetail('');
    setIsSaving(true);

    try {
      const result = await configureServer(serverInput);
      onConfigured?.(result);
      navigate(returnTo, { replace: true });
    } catch (connectionError) {
      setTestResult('error');
      setError(getConnectionErrorMessage(connectionError));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <div className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-10 sm:px-6">
        <div className="w-full rounded-2xl border border-stone-200/60 bg-white p-6 shadow-xl shadow-stone-200/50 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50">
          <div className="mb-5">
            <h1 className="text-2xl font-bold text-stone-900 dark:text-stone-100">Connect to your server</h1>
            <p className="mt-2 text-sm text-stone-500 dark:text-stone-400">
              Enter the Budget App server URL before signing in. This should be reachable from this device
              (for example over Tailscale).
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="server-url" className="block text-sm font-medium text-stone-700 dark:text-stone-300">
                Server URL
              </label>
              <input
                id="server-url"
                type="text"
                value={serverInput}
                onChange={(event) => setServerInput(event.target.value)}
                required
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://budget.your-tailnet.ts.net"
                className="w-full rounded-xl border border-stone-300 bg-stone-50/50 px-4 py-2.5 text-base text-stone-900 placeholder-stone-400 transition-colors focus:border-transparent focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-stone-600 dark:bg-stone-700/50 dark:text-stone-100 dark:placeholder-stone-500 dark:focus:bg-stone-700"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
                <p className="text-sm font-medium text-red-700 dark:text-red-400">
                  <span className="mr-1.5">⚠</span>
                  {error}
                </p>
              </div>
            )}

            {testResult === 'success' && successDetail && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950">
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <span className="mr-1.5">✓</span>
                  {successDetail}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || isSaving}
                className="flex-1 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-200 dark:hover:bg-stone-600"
              >
                {isTesting ? 'Testing…' : 'Test connection'}
              </button>

              <button
                type="submit"
                disabled={isTesting || isSaving}
                className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-amber-200/50 transition-all hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none dark:shadow-amber-900/30"
              >
                {isSaving ? 'Saving…' : 'Save and continue'}
              </button>
            </div>

            {serverState?.status === 'ready' && !hasChanged && (
              <p className="text-xs text-stone-500 dark:text-stone-400">
                Current server is already configured.
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
