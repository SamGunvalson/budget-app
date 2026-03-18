import { createClient } from "@supabase/supabase-js";
import { clearAllOfflineData } from "./offlineDb";

// Get environment variables — prefer runtime window.__ENV__ (Docker) over build-time import.meta.env (local dev).
// Placeholder strings (beginning with "__") mean the entrypoint hasn't replaced them yet; fall back to Vite env.
const runtimeUrl = window.__ENV__?.SUPABASE_URL;
const runtimeKey = window.__ENV__?.SUPABASE_ANON_KEY;
const supabaseUrl =
  runtimeUrl && !runtimeUrl.startsWith("__")
    ? runtimeUrl
    : import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  runtimeKey && !runtimeKey.startsWith("__")
    ? runtimeKey
    : import.meta.env.VITE_SUPABASE_ANON_KEY;

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Please check your .env file or container environment.",
  );
}

// Create Supabase client
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper function to get current user
export const getCurrentUser = async () => {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  return user;
};

// Helper function to sign out — clears all local data before ending the session
export const signOut = async () => {
  try {
    await clearAllOfflineData();
  } catch {
    // Non-fatal: proceed with sign-out even if local data clear fails
  }
  sessionStorage.clear();
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};
