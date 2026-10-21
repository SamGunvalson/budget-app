// This file is overwritten at container startup by docker-entrypoint.sh.
// For local development, this file is ignored — the app falls back to import.meta.env.
window.__ENV__ = {
  BACKEND_MODE: "__BACKEND_MODE__",
  SUPABASE_URL: "__SUPABASE_URL__",
  SUPABASE_ANON_KEY: "__SUPABASE_ANON_KEY__",
};
