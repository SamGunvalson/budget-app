/**
 * Shared network-error classification for the offline layer (offlineAware.js
 * writes and cache.js reads).
 */

// Message fragments browsers and HTTP stacks use for "the request never got
// an answer": Chrome "Failed to fetch", Safari "Load failed", Firefox
// "NetworkError when attempting to fetch resource", React Native / Capacitor
// "Network request failed", plus timeouts, aborts and gateway errors. The
// PostgREST client reports a failed fetch as a plain `{ message, code: "" }`
// object whose message starts with the original error's name, so the name
// alone cannot be relied on.
const CONNECTIVITY_MESSAGE =
  /failed to fetch|load failed|network|timed? ?out|\babort(ed)?\b|aborterror|bad gateway|service unavailable|gateway time-?out|jwt expired|invalid token/i;

/**
 * Did this error come from not reaching the backend (so the write should be
 * queued), as opposed to the backend rejecting the request (so the user must
 * see the error — queueing it would only fail again on every sync)?
 *
 * Checked in order of reliability: HTTP status, then the backend's error
 * code, then the error name, and only then the message text.
 */
export function isConnectivityError(err) {
  if (!navigator.onLine) return true;
  if (!err) return false;

  const status = typeof err.status === "number" ? err.status : null;
  // 0 = no response; 502–504 = a proxy could not reach the backend;
  // 401 = expired session, which the local cache can ride out.
  if (status === 0 || status === 401 || (status >= 502 && status <= 504)) {
    return true;
  }
  // Any other 4xx/5xx is the backend's considered answer.
  if (status !== null && status >= 400) return false;

  const code = typeof err.code === "string" ? err.code : "";
  // PGRST301 = JWT expired; PGRST000–003 = PostgREST cannot reach the database.
  if (code === "PGRST301" || /^PGRST00[0-3]$/.test(code)) return true;
  // A SQLSTATE (constraint, RLS, check violation…) or another PostgREST code
  // is a real rejection, whatever its message happens to contain.
  if (/^[0-9A-Z]{5}$/.test(code) || code.startsWith("PGRST")) return false;

  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  return CONNECTIVITY_MESSAGE.test(String(err.message ?? ""));
}
