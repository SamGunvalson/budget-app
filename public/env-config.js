// This file is overwritten at container startup by docker-entrypoint.sh.
// The placeholder strings below are replaced with real environment variable values.
// For local development, this file is ignored — the app falls back to import.meta.env (Vite .env files).
window.__ENV__ = {
  SUPABASE_URL: "__SUPABASE_URL__",
  SUPABASE_ANON_KEY: "__SUPABASE_ANON_KEY__",
};
