import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LoginForm from '../components/common/LoginForm';
import SignupForm from '../components/common/SignupForm';
import { supabase } from '../services/supabase';

const features = [
  {
    text: 'Set monthly budgets by category',
    icon: (
      <svg className="h-5 w-5 text-teal-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    text: 'Track spending as it happens',
    icon: (
      <svg className="h-5 w-5 text-teal-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    text: 'Your data stays private and secure',
    icon: (
      <svg className="h-5 w-5 text-teal-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
];

function AuthPage() {
  const [mode, setMode] = useState('login');
  const [isChecking, setIsChecking] = useState(true);
  const navigate = useNavigate();

  useEffect(() => { document.title = 'Budget App | Sign In'; }, []);

  useEffect(() => {
    let isMounted = true;

    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isMounted) return;

      if (data?.session) {
        navigate('/app', { replace: true });
        return;
      }

      setIsChecking(false);
    };

    checkSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!isMounted) return;

        if (session) {
          navigate('/app', { replace: true });
        }
      }
    );

    return () => {
      isMounted = false;
      authListener?.subscription?.unsubscribe();
    };
  }, [navigate]);

  const handleSuccess = (session) => {
    if (session) {
      navigate('/app', { replace: true });
      return;
    }

    setMode('login');
  };

  if (isChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
        <div className="flex items-center gap-3 rounded-2xl bg-white px-6 py-4 shadow-lg shadow-stone-200/50 dark:bg-stone-800 dark:shadow-stone-900/50">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
          <span className="text-sm font-medium text-stone-600 dark:text-stone-300">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-amber-50/30 to-stone-100 dark:from-stone-950 dark:via-stone-900 dark:to-stone-950">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        {/* Intro Section */}
        <div className="animate-fade-in mx-auto mb-8 max-w-md text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-4 py-1.5 text-sm font-semibold text-amber-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Budget App
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl dark:text-stone-100">
            Take control of your money
          </h1>
          <p className="mt-3 text-base text-stone-500 dark:text-stone-400">
            Track spending, plan with confidence, and build stronger financial habits.
          </p>
        </div>

        {/* Features */}
        <div className="animate-fade-in-up mx-auto mb-8 max-w-md space-y-3">
          {features.map((f) => (
            <div
              key={f.text}
              className="flex items-center gap-3 rounded-xl border border-stone-200/60 bg-white/70 px-4 py-3 shadow-sm backdrop-blur-sm dark:border-stone-700/60 dark:bg-stone-800/70"
            >
              {f.icon}
              <p className="text-sm font-medium text-stone-700 dark:text-stone-300">{f.text}</p>
            </div>
          ))}
        </div>

        {/* Auth Form Card */}
        <div className="animate-fade-in-up mx-auto max-w-md rounded-2xl border border-stone-200/60 bg-white p-6 shadow-xl shadow-stone-200/50 dark:border-stone-700/60 dark:bg-stone-800 dark:shadow-stone-900/50" style={{ animationDelay: '200ms' }}>
          {/* Mode Toggle */}
          <div className="mb-5 flex gap-1 rounded-xl bg-stone-100 p-1 dark:bg-stone-700">
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                mode === 'login'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-200/50'
                  : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('signup')}
              className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 ${
                mode === 'signup'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-200/50'
                  : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              Create account
            </button>
          </div>

          {/* Form Content */}
          <div>
            {mode === 'login' ? (
              <LoginForm onSuccess={handleSuccess} />
            ) : (
              <SignupForm onSuccess={handleSuccess} />
            )}
          </div>

          <p className="mt-6 text-center text-xs text-stone-400 dark:text-stone-500">
            Your account is secured with end-to-end encryption.
          </p>
        </div>

        <div className="mt-12" />
      </div>
    </div>
  );
}

export default AuthPage;
