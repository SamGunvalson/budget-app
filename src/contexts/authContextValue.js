import { createContext } from "react";

const AuthContext = createContext({
  session: null,
  isChecking: true,
});

export default AuthContext;

/** The signed-in user's id for a session, or `null` when signed out. */
export function getSessionUserId(session) {
  return session?.user?.id ?? null;
}

/**
 * Classify a move from one signed-in identity to the next. This is the single
 * definition of "the user changed" that per-user state resets hang off:
 *
 *  - `'none'`       same identity (e.g. a token refresh) — reset nothing
 *  - `'signed-in'`  nobody → a user
 *  - `'signed-out'` a user → nobody
 *  - `'switched'`   one user → a different user, with no sign-out in between
 *
 * @param {string|null|undefined} prevUserId
 * @param {string|null|undefined} nextUserId
 * @returns {'none'|'signed-in'|'signed-out'|'switched'}
 */
export function classifySessionChange(prevUserId, nextUserId) {
  const prev = prevUserId ?? null;
  const next = nextUserId ?? null;
  if (prev === next) return "none";
  if (prev === null) return "signed-in";
  if (next === null) return "signed-out";
  return "switched";
}
