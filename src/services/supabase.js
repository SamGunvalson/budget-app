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

// Helper function to sign out — clears all local data before ending the session.
// Wipes (in order, all best-effort): IndexedDB, sessionStorage, app-scoped
// localStorage keys, and Workbox runtime caches. The Supabase auth tokens in
// localStorage are cleared by `supabase.auth.signOut()` itself.
export const signOut = async () => {
  try {
    await clearAllOfflineData();
  } catch {
    // Non-fatal: proceed with sign-out even if local data clear fails
  }

  try {
    sessionStorage.clear();
  } catch {
    /* storage unavailable */
  }

  // Clear app-scoped localStorage entries (e.g. splitSeenAt_<userId>) so a
  // subsequent user on the same device does not inherit prior UI state.
  try {
    const APP_PREFIXES = ["splitSeenAt_"];
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && APP_PREFIXES.some((p) => k.startsWith(p))) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable */
  }

  // Clear Workbox runtime caches so the next user does not see the previous
  // user's cached Supabase REST responses (T4 — stolen-device / shared-device).
  try {
    if ("caches" in self) {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter(
            (n) => n.startsWith("supabase-api") || n.startsWith("workbox-"),
          )
          .map((n) => caches.delete(n)),
      );
    }
  } catch {
    /* cache API unavailable */
  }

  const { error } = await supabase.auth.signOut();
  if (error) throw error;
};
