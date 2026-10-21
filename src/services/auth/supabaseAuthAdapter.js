import { getSupabaseClientOrThrow } from '../backend';

const normalize = ({ data, error }) => ({ session: data?.session ?? null, error: error ?? null });

export const getSession = async () => normalize(await getSupabaseClientOrThrow().auth.getSession());
export const onAuthStateChange = (callback) => {
  const { data } = getSupabaseClientOrThrow().auth.onAuthStateChange(callback);
  return () => data?.subscription?.unsubscribe();
};
export const signInWithPassword = async (credentials) => normalize(await getSupabaseClientOrThrow().auth.signInWithPassword(credentials));
export const signUp = async (credentials) => {
  const result = normalize(await getSupabaseClientOrThrow().auth.signUp(credentials));
  return { ...result, needsConfirmation: !result.error && !result.session };
};
export const signOut = async () => {
  const { error } = await getSupabaseClientOrThrow().auth.signOut();
  if (error) throw error;
};
export const updatePassword = async ({ currentPassword, newPassword }) => {
  const client = getSupabaseClientOrThrow();
  const { data, error: sessionError } = await client.auth.getSession();
  const email = data?.session?.user?.email;
  if (sessionError || !email) return { error: sessionError || new Error('You must be signed in to change your password.') };
  const { error: verifyError } = await client.auth.signInWithPassword({ email, password: currentPassword });
  if (verifyError) return { error: verifyError };
  const { error } = await client.auth.updateUser({ password: newPassword });
  return { error: error ?? null };
};
export const getAccessToken = async ({ forceRefresh = false } = {}) => {
  const auth = getSupabaseClientOrThrow().auth;
  if (forceRefresh) {
    const { data, error } = await auth.refreshSession();
    if (error) throw error;
    return data?.session?.access_token ?? null;
  }
  const { data, error } = await auth.getSession();
  if (error) throw error;
  return data?.session?.access_token ?? null;
};
export const getSignupHealth = async () => ({ signupEnabled: true });
